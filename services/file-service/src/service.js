import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { BadRequest, Events, NotFound, enqueueEvent, getLogger, paginated, withTransaction } from '@spendwise/common';
import { IMPORT_TYPES, RECEIPT_TYPES, sanitizeFileName, sniff } from './filetype.js';
import { normalizeRecords, readCsv, readXlsx } from './importer.js';

const BATCH_SIZE = 200;

const toFile = (row) => ({
  id: row.id,
  kind: row.kind,
  fileName: row.original_name,
  mimeType: row.mime_type,
  size: row.size_bytes,
  sha256: row.sha256,
  createdAt: row.created_at,
});

const toImport = (row) => ({
  id: row.id,
  fileId: row.file_id,
  fileName: row.file_name,
  status: row.status,
  totalRows: row.total_rows,
  validRows: row.valid_rows,
  failedRows: row.failed_rows,
  expenseRows: row.expense_rows,
  incomeRows: row.income_rows,
  errors: row.errors,
  createdAt: row.created_at,
});

export function createFileService({ pool, config }) {
  const log = getLogger();
  const root = path.resolve(config.FILES_DIR);

  const resolveKey = (key) => {
    const full = path.resolve(root, key);
    if (!full.startsWith(root + path.sep)) throw NotFound('File not found'); // path traversal guard
    return full;
  };

  async function store(client, userId, kind, upload, detected) {
    const id = randomUUID();
    const storageKey = path.join(userId, id); // never derived from user input
    await mkdir(path.join(root, userId), { recursive: true });
    await writeFile(resolveKey(storageKey), upload.buffer, { mode: 0o600 });
    const { rows } = await client.query(
      `INSERT INTO files (id, user_id, kind, original_name, mime_type, size_bytes, sha256, storage_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        id, userId, kind, sanitizeFileName(upload.originalname, detected.ext), detected.mime, upload.size,
        createHash('sha256').update(upload.buffer).digest('hex'), storageKey,
      ],
    );
    return rows[0];
  }

  return {
    async uploadReceipt(userId, upload) {
      if (!upload) throw BadRequest('A file is required (multipart field "file")');
      const detected = sniff(upload.buffer);
      if (!detected || !RECEIPT_TYPES.has(detected.mime)) throw BadRequest('Receipts must be JPEG, PNG, WebP or PDF files');
      return withTransaction(pool, async (client) => {
        const row = await store(client, userId, 'receipt', upload, detected);
        await enqueueEvent(client, Events.ReceiptUploaded, { fileId: row.id, userId, mimeType: row.mime_type, size: row.size_bytes });
        return toFile(row);
      });
    },

    async list(userId, kind, { page, pageSize }) {
      const [{ rows }, { rows: count }] = await Promise.all([
        pool.query(
          'SELECT * FROM files WHERE user_id = $1 AND kind = $2 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT $3 OFFSET $4',
          [userId, kind, pageSize, (page - 1) * pageSize],
        ),
        pool.query('SELECT count(*)::int AS n FROM files WHERE user_id = $1 AND kind = $2 AND deleted_at IS NULL', [userId, kind]),
      ]);
      return paginated(rows.map(toFile), { page, pageSize }, count[0].n);
    },

    async get(userId, id) {
      const { rows } = await pool.query('SELECT * FROM files WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL', [id, userId]);
      if (!rows[0]) throw NotFound('File not found');
      return rows[0];
    },

    async metadata(userId, id) {
      return toFile(await this.get(userId, id));
    },

    async download(userId, id) {
      const row = await this.get(userId, id);
      return { filePath: resolveKey(row.storage_key), fileName: row.original_name, mimeType: row.mime_type, size: row.size_bytes };
    },

    async remove(userId, id) {
      const row = await this.get(userId, id);
      await pool.query('UPDATE files SET deleted_at = now() WHERE id = $1', [id]);
      await rm(resolveKey(row.storage_key), { force: true });
    },

    /**
     * Parses and validates a CSV/XLSX import, then publishes the valid rows in batches
     * (ImportBatchReady -> expense/income services) and a FileImported summary, all
     * atomically through the outbox.
     */
    async importTransactions(userId, upload, options) {
      if (!upload) throw BadRequest('A file is required (multipart field "file")');
      const detected = sniff(upload.buffer);
      if (!detected || !IMPORT_TYPES.has(detected.mime)) throw BadRequest('Imports must be CSV or Excel (.xlsx) files');
      let records;
      try {
        records = detected.ext === 'xlsx' ? await readXlsx(upload.buffer) : readCsv(upload.buffer);
      } catch (err) {
        log.warn({ err: err.message }, 'unparseable import file');
        throw BadRequest('The file could not be parsed. Check that it is a valid CSV or Excel file with a header row.');
      }
      if (records.length === 0) throw BadRequest('The file contains no data rows');
      const { rows, errors, totalRows } = normalizeRecords(records, options);
      if (rows.length === 0) {
        throw BadRequest('No valid rows found. Required columns: date, amount, description.', errors.slice(0, 20).map((e) => ({ path: `row ${e.row}`, message: e.message })));
      }
      return withTransaction(pool, async (client) => {
        const file = await store(client, userId, 'import', upload, detected);
        const counts = { expense: rows.filter((r) => r.type === 'expense').length, income: rows.filter((r) => r.type === 'income').length };
        const { rows: inserted } = await client.query(
          `INSERT INTO imports (user_id, file_id, file_name, status, total_rows, valid_rows, failed_rows, expense_rows, income_rows, errors)
           VALUES ($1,$2,$3,'completed',$4,$5,$6,$7,$8,$9) RETURNING *`,
          [userId, file.id, file.original_name, totalRows, rows.length, errors.length, counts.expense, counts.income, JSON.stringify(errors.slice(0, 200))],
        );
        const record = inserted[0];
        for (let i = 0; i < rows.length; i += BATCH_SIZE) {
          await enqueueEvent(client, Events.ImportBatchReady, { userId, importId: record.id, batch: i / BATCH_SIZE + 1, rows: rows.slice(i, i + BATCH_SIZE) });
        }
        await enqueueEvent(client, Events.FileImported, {
          userId,
          importId: record.id,
          fileName: record.file_name,
          totalRows,
          importedRows: rows.length,
          failedRows: errors.length,
          expenseRows: counts.expense,
          incomeRows: counts.income,
        });
        return toImport(record);
      });
    },

    async listImports(userId, { page, pageSize }) {
      const [{ rows }, { rows: count }] = await Promise.all([
        pool.query('SELECT * FROM imports WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3', [userId, pageSize, (page - 1) * pageSize]),
        pool.query('SELECT count(*)::int AS n FROM imports WHERE user_id = $1', [userId]),
      ]);
      return paginated(rows.map(toImport), { page, pageSize }, count[0].n);
    },

    async getImport(userId, id) {
      const { rows } = await pool.query('SELECT * FROM imports WHERE id = $1 AND user_id = $2', [id, userId]);
      if (!rows[0]) throw NotFound('Import not found');
      return toImport(rows[0]);
    },
  };
}
