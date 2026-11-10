import { createReadStream } from 'node:fs';
import { ApiRouter, createApp, idParams, isoDate, pagination, safeText, z } from '@spendwise/common';

export const createReportSchema = z
  .object({
    title: safeText(120).pipe(z.string().min(1)).optional(),
    type: z.enum(['full', 'transactions', 'summary']).default('full'),
    format: z.enum(['pdf', 'csv', 'xlsx']),
    from: isoDate,
    to: isoDate,
  })
  .refine((v) => v.from <= v.to, { message: '`from` must be before `to`', path: ['from'] })
  .refine((v) => (new Date(v.to) - new Date(v.from)) / 86_400_000 <= 1830, { message: 'Reports can cover at most 5 years', path: ['to'] });

export function buildApp({ service, readiness = {}, enableDocs = true }) {
  const reports = new ApiRouter({ prefix: '/api/v1/reports', tags: ['Reports'] });
  reports.get('/', { summary: 'List my reports', query: pagination, handler: (req) => service.list(req.user.id, req.valid.query) });
  reports.post('/', {
    summary: 'Request a PDF/CSV/Excel report (generated asynchronously; ReportGenerated when ready)',
    status: 202,
    body: createReportSchema,
    handler: (req) => service.request(req.user.id, req.valid.body),
  });
  reports.get('/:id', { summary: 'Report status', params: idParams, handler: (req) => service.get(req.user.id, req.valid.params.id) });
  reports.get('/:id/download', {
    summary: 'Download a completed report',
    params: idParams,
    raw: true,
    responseDescription: 'The report file',
    handler: async (req, res) => {
      const file = await service.download(req.user.id, req.valid.params.id);
      res.setHeader('Content-Type', file.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${file.fileName.replace(/[^\w.-]/g, '_')}"`);
      res.setHeader('Cache-Control', 'private, no-store');
      await new Promise((resolve, reject) => {
        const stream = createReadStream(file.filePath);
        stream.on('error', reject);
        stream.on('end', resolve);
        stream.pipe(res);
      });
    },
  });
  reports.delete('/:id', { summary: 'Delete a report', params: idParams, handler: (req) => service.remove(req.user.id, req.valid.params.id) });

  return createApp({
    name: 'report-service',
    description: 'Asynchronous PDF, CSV and Excel financial reports.',
    routers: [reports],
    readiness,
    enableDocs,
  });
}
