import { ApiRouter, createApp, idParams } from '@spendwise/common';

export function buildApp({ service, readiness = {}, enableDocs = true }) {
  const insights = new ApiRouter({ prefix: '/api/v1/insights', tags: ['AI insights'] });
  insights.get('/', { summary: 'Stored insights (e.g. detected anomalies)', handler: (req) => service.list(req.user.id) });
  insights.get('/overview', {
    summary: 'Health score, month-end forecast, category trends, recommendations and a narrative summary',
    handler: (req) => service.overview(req.user.id),
  });
  insights.post('/:id/dismiss', { summary: 'Dismiss an insight', params: idParams, handler: (req) => service.dismiss(req.user.id, req.valid.params.id) });

  return createApp({
    name: 'ai-service',
    description: 'AI-powered spending insights: anomaly detection, trends, forecasts and recommendations.',
    routers: [insights],
    readiness,
    enableDocs,
  });
}
