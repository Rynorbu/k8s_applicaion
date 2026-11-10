import { createReadStream } from 'node:fs';
import multer from 'multer';
import { ApiRouter, createApp, idParams, pagination, uuid, z } from '@spendwise/common';
import { IMPORT_TEMPLATE } from './importer.js';

const multipart = (description) => ({
  required: true,
  content: {
    'multipart/form-data': {
      schema: {
        type: 'object',
        required: ['file'],
        properties: {
          file: { type: 'string', format: 'binary', description },
          defaultType: { type: 'string', enum: ['expense', 'income'] },
          dateFormat: { type: 'string', enum: ['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY'] },
        },
      },
    },
  },
});

export const importOptionsSchema = z.object({
  defaultType: z.enum(['expense', 'income']).default('expense'),
  dateFormat: z.enum(['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY']).default('YYYY-MM-DD'),
});

export function buildApp({ service, config, readiness = {}, enableDocs = true }) {
  // Memory storage + strict limits: one file, bounded size, only expected fields.
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.MAX_UPLOAD_BYTES, files: 1, fields: 5, fieldSize: 1024 },
  }).single('file');

  const sendFile = async (res, file, disposition = 'attachment') => {
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Length', file.size);
    res.setHeader('Content-Disposition', `${disposition}; filename="${file.fileName.replace(/[^\w.-]/g, '_')}"`);
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
    res.setHeader('Cache-Control', 'private, no-store');
    await new Promise((resolve, reject) => {
      const stream = createReadStream(file.filePath);
      stream.on('error', reject);
      stream.on('end', resolve);
      stream.pipe(res);
    });
  };

  const files = new ApiRouter({ prefix: '/api/v1/files', tags: ['Files'] });
  files.post('/receipts', {
    summary: 'Upload a receipt (JPEG, PNG, WebP or PDF; verified by content)',
    status: 201,
    middleware: [upload],
    requestBody: multipart('Receipt image or PDF'),
    handler: (req) => service.uploadReceipt(req.user.id, req.file),
  });
  files.get('/receipts', { summary: 'List receipts', query: pagination, handler: (req) => service.list(req.user.id, 'receipt', req.valid.query) });
  files.post('/imports', {
    summary: 'Import transactions from CSV or Excel (publishes ImportBatchReady + FileImported)',
    status: 201,
    middleware: [upload],
    requestBody: multipart('CSV or XLSX file with a header row'),
    body: importOptionsSchema,
    handler: (req) => service.importTransactions(req.user.id, req.file, req.valid.body),
  });
  files.get('/imports', { summary: 'Import history', query: pagination, handler: (req) => service.listImports(req.user.id, req.valid.query) });
  files.get('/imports/template', {
    summary: 'Download a CSV import template',
    raw: true,
    handler: (req, res) => {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="spendwise-import-template.csv"');
      res.send(IMPORT_TEMPLATE);
    },
  });
  files.get('/imports/:id', { summary: 'Import result', params: idParams, handler: (req) => service.getImport(req.user.id, req.valid.params.id) });
  files.get('/:id', { summary: 'File metadata', params: idParams, handler: (req) => service.metadata(req.user.id, req.valid.params.id) });
  files.get('/:id/download', {
    summary: 'Download a file (inline=true previews images/PDFs)',
    params: idParams,
    query: z.object({ inline: z.enum(['true', 'false']).default('false') }),
    raw: true,
    handler: async (req, res) => {
      const file = await service.download(req.user.id, req.valid.params.id);
      await sendFile(res, file, req.valid.query.inline === 'true' ? 'inline' : 'attachment');
    },
  });
  files.delete('/:id', { summary: 'Delete a file', params: idParams, handler: (req) => service.remove(req.user.id, req.valid.params.id) });

  const internal = new ApiRouter({ prefix: '/internal/files', tags: ['Internal'] });
  internal.get('/:id', {
    auth: 'internal',
    summary: 'File metadata for ownership checks',
    params: idParams,
    query: z.object({ userId: uuid }),
    handler: (req) => service.metadata(req.valid.query.userId, req.valid.params.id),
  });

  return createApp({
    name: 'file-service',
    description: 'Receipt uploads and CSV/Excel transaction imports.',
    routers: [files, internal],
    readiness,
    enableDocs,
  });
}
