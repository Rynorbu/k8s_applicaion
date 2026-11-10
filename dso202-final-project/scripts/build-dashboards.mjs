#!/usr/bin/env node
/**
 * Generates the three Grafana dashboards (JSON) shipped by charts/monitoring-extras:
 *   spendwise-application.json    - golden signals for the 17 microservices + events
 *   spendwise-autoscaling.json    - HPA replicas vs the custom metrics that drive them
 *   spendwise-infrastructure.json - nodes, pods, storage, PostgreSQL, RabbitMQ
 * Run:  node scripts/build-dashboards.mjs   (from dso202-final-project/)
 */
import { mkdirSync, writeFileSync } from 'node:fs';

const DS = { type: 'prometheus', uid: 'prometheus' };
const NS = 'namespace="$namespace"';
const SVC = `${NS}, service=~"$service"`;
// Reserved status colours (good / warning / critical).
const GOOD = '#0ca30c';
const WARN = '#fab219';
const CRIT = '#d03b3b';

const target = (expr, legendFormat = '', extra = {}, i = 0) => ({ datasource: DS, expr, legendFormat, refId: 'ABCDEFGH'[i], ...extra });

function stat(title, expr, { unit = 'short', x, y, w = 4, h = 4, thresholds, decimals, description } = {}) {
  return {
    type: 'stat', title, description, datasource: DS, gridPos: { x, y, w, h },
    targets: [target(expr)],
    options: { reduceOptions: { calcs: ['lastNotNull'] }, colorMode: 'value', graphMode: 'area', textMode: 'value' },
    fieldConfig: {
      defaults: {
        unit, decimals,
        color: { mode: thresholds ? 'thresholds' : 'fixed', fixedColor: 'text' },
        thresholds: { mode: 'absolute', steps: thresholds ?? [{ color: 'text', value: null }] },
      },
      overrides: [],
    },
  };
}

function ts(title, targets, { unit = 'short', x, y, w = 12, h = 8, stack = false, description, min, overrides = [] } = {}) {
  return {
    type: 'timeseries', title, description, datasource: DS, gridPos: { x, y, w, h },
    targets: targets.map(([expr, legend, extra], i) => target(expr, legend, extra, i)),
    options: { legend: { displayMode: 'table', placement: 'right', calcs: ['lastNotNull', 'max'] }, tooltip: { mode: 'multi', sort: 'desc' } },
    fieldConfig: {
      defaults: {
        unit, min,
        color: { mode: 'palette-classic' },
        custom: { lineWidth: 2, fillOpacity: stack ? 30 : 8, showPoints: 'never', stacking: { mode: stack ? 'normal' : 'none' }, spanNulls: true },
      },
      overrides,
    },
  };
}

function bar(title, expr, legend, { x, y, w = 12, h = 8, unit = 'short' } = {}) {
  return {
    type: 'bargauge', title, datasource: DS, gridPos: { x, y, w, h },
    targets: [target(expr, legend, { instant: true })],
    options: { orientation: 'horizontal', displayMode: 'basic', showUnfilled: true, reduceOptions: { calcs: ['lastNotNull'] } },
    fieldConfig: { defaults: { unit, color: { mode: 'fixed', fixedColor: '#2a78d6' }, min: 0 }, overrides: [] },
  };
}

function table(title, expr, { x, y, w = 12, h = 8, unit = 'short', columns }) {
  return {
    type: 'table', title, datasource: DS, gridPos: { x, y, w, h },
    targets: [target(expr, '', { instant: true, format: 'table' })],
    transformations: [{ id: 'organize', options: { excludeByName: { Time: true }, renameByName: columns } }],
    fieldConfig: { defaults: { unit }, overrides: [] },
    options: { showHeader: true, sortBy: [{ displayName: 'Value', desc: true }] },
  };
}

const row = (title, y) => ({ type: 'row', title, collapsed: false, gridPos: { x: 0, y, w: 24, h: 1 }, panels: [] });

function variables(extra = []) {
  return {
    list: [
      {
        name: 'namespace', label: 'Namespace', type: 'custom', query: 'spendwise',
        current: { text: 'spendwise', value: 'spendwise' }, options: [{ text: 'spendwise', value: 'spendwise', selected: true }],
      },
      ...extra,
    ],
  };
}

const serviceVar = {
  name: 'service', label: 'Service', type: 'query', datasource: DS,
  query: { query: 'label_values(http_request_duration_seconds_count{namespace="$namespace"}, service)', refId: 'svc' },
  definition: 'label_values(http_request_duration_seconds_count{namespace="$namespace"}, service)',
  includeAll: true, multi: true, allValue: '.*', refresh: 2, sort: 1,
  current: { text: 'All', value: '$__all' },
};

function dashboard(uid, title, description, panels, templating, tags) {
  return {
    uid, title, description, tags: ['spendwise', 'dso202', ...tags], timezone: 'browser', editable: true,
    schemaVersion: 39, version: 1, refresh: '10s', time: { from: 'now-30m', to: 'now' },
    templating, annotations: { list: [] }, panels,
  };
}

// ---------------------------------------------------------------- Application
const app = dashboard('spendwise-app', 'SpendWise · Application', 'Golden signals (traffic, errors, latency, saturation) for every microservice, plus event-driven messaging health.', [
  row('Overview', 0),
  stat('Service pods up', `sum(up{${NS}, job=~".*-service|api-gateway"})`, { x: 0, y: 1, description: 'Microservice pods Prometheus can scrape', thresholds: [{ color: CRIT, value: null }, { color: WARN, value: 10 }, { color: GOOD, value: 17 }] }),
  stat('Requests / s', `sum(rate(http_request_duration_seconds_count{${SVC}}[1m]))`, { x: 4, y: 1, unit: 'reqps', decimals: 1 }),
  stat('5xx error rate', `(sum(rate(http_request_duration_seconds_count{${SVC}, status_code=~"5.."}[5m])) or vector(0)) / clamp_min(sum(rate(http_request_duration_seconds_count{${SVC}}[5m])), 1e-9)`, { x: 8, y: 1, unit: 'percentunit', decimals: 2, thresholds: [{ color: GOOD, value: null }, { color: WARN, value: 0.01 }, { color: CRIT, value: 0.05 }] }),
  stat('p95 latency', `histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket{${SVC}}[5m])))`, { x: 12, y: 1, unit: 's', decimals: 3, thresholds: [{ color: GOOD, value: null }, { color: WARN, value: 0.3 }, { color: CRIT, value: 1 }] }),
  stat('Outbox backlog', `sum(outbox_pending_events{${NS}})`, { x: 16, y: 1, description: 'Events written to a service database but not yet published to RabbitMQ', thresholds: [{ color: GOOD, value: null }, { color: WARN, value: 50 }, { color: CRIT, value: 500 }] }),
  stat('Dead-lettered (1h)', `sum(increase(events_consumed_total{${NS}, outcome="dead_letter"}[1h])) or vector(0)`, { x: 20, y: 1, decimals: 0, thresholds: [{ color: GOOD, value: null }, { color: CRIT, value: 1 }] }),
  row('Traffic, errors and latency', 5),
  ts('Request rate by service', [[`sum by (service) (rate(http_request_duration_seconds_count{${SVC}}[1m]))`, '{{service}}']], { x: 0, y: 6, unit: 'reqps' }),
  ts('p95 latency by service', [[`histogram_quantile(0.95, sum by (service, le) (rate(http_request_duration_seconds_bucket{${SVC}}[5m])))`, '{{service}}']], { x: 12, y: 6, unit: 's' }),
  ts('HTTP 4xx / 5xx by service', [[`sum by (service, status_code) (rate(http_request_duration_seconds_count{${SVC}, status_code=~"[45].."}[5m]))`, '{{service}} {{status_code}}']], { x: 0, y: 14, unit: 'reqps' }),
  table('Busiest routes (req/s, last 5m)', `topk(10, sum by (service, method, route) (rate(http_request_duration_seconds_count{${SVC}}[5m])))`, { x: 12, y: 14, unit: 'reqps', columns: { service: 'Service', method: 'Method', route: 'Route', Value: 'req/s' } }),
  row('Event-driven messaging (RabbitMQ)', 22),
  ts('Events published by type', [[`sum by (type) (rate(events_published_total{${NS}}[5m]))`, '{{type}}']], { x: 0, y: 23, w: 8, unit: 'ops' }),
  ts('Events consumed by outcome', [[`sum by (outcome) (rate(events_consumed_total{${NS}}[5m]))`, '{{outcome}}']], { x: 8, y: 23, w: 8, unit: 'ops', stack: true }),
  ts('Event processing p95 by service', [[`histogram_quantile(0.95, sum by (service, le) (rate(event_processing_duration_seconds_bucket{${NS}}[5m])))`, '{{service}}']], { x: 16, y: 23, w: 8, unit: 's' }),
  row('Business activity and runtime', 31),
  bar('Business events (last 1h)', `sort_desc(sum by (name) (increase(spendwise_business_events_total{${NS}}[1h])))`, '{{name}}', { x: 0, y: 32, w: 8 }),
  ts('Node.js heap used', [[`sum by (service) (nodejs_heap_size_used_bytes{${SVC}})`, '{{service}}']], { x: 8, y: 32, w: 8, unit: 'bytes' }),
  ts('Event-loop lag p99', [[`max by (service) (nodejs_eventloop_lag_p99_seconds{${SVC}})`, '{{service}}']], { x: 16, y: 32, w: 8, unit: 's' }),
], variables([serviceVar]), ['application']);

// ---------------------------------------------------------------- Autoscaling
const hpaVar = {
  name: 'hpa', label: 'HPA', type: 'query', datasource: DS,
  query: { query: 'label_values(kube_horizontalpodautoscaler_status_current_replicas{namespace="$namespace"}, horizontalpodautoscaler)', refId: 'hpa' },
  definition: 'label_values(kube_horizontalpodautoscaler_status_current_replicas{namespace="$namespace"}, horizontalpodautoscaler)',
  includeAll: true, multi: true, allValue: '.*', refresh: 2, current: { text: 'All', value: '$__all' },
};
const HPA = `${NS}, horizontalpodautoscaler=~"$hpa"`;
const autoscaling = dashboard('spendwise-hpa', 'SpendWise · Autoscaling', 'Horizontal Pod Autoscalers and the custom metrics (requests/s per pod, RabbitMQ queue depth) that drive them.', [
  row('Replicas', 0),
  ts('Current vs desired replicas', [
    [`kube_horizontalpodautoscaler_status_current_replicas{${HPA}}`, '{{horizontalpodautoscaler}} current'],
    [`kube_horizontalpodautoscaler_status_desired_replicas{${HPA}}`, '{{horizontalpodautoscaler}} desired'],
  ], { x: 0, y: 1, w: 16, h: 9, min: 0, description: 'Desired jumps first; current follows once the new pods are Ready' }),
  bar('Max replicas per HPA', `max by (horizontalpodautoscaler) (kube_horizontalpodautoscaler_spec_max_replicas{${HPA}})`, '{{horizontalpodautoscaler}}', { x: 16, y: 1, w: 8, h: 9 }),
  row('Custom metrics (prometheus-adapter)', 10),
  ts('Requests / s per pod (http_requests_per_second)', [
    [`sum by (pod) (rate(http_request_duration_seconds_count{${NS}, service=~"api-gateway|expense-service|analytics-service"}[1m]))`, '{{pod}}'],
    [`kube_horizontalpodautoscaler_spec_target_metric{${HPA}, metric_name="http_requests_per_second"}`, 'target {{horizontalpodautoscaler}}'],
  ], { x: 0, y: 11, unit: 'reqps', description: 'Same query the adapter serves to the HPA. Dashed lines = per-pod targets.', overrides: [{ matcher: { id: 'byRegexp', options: '^target.*' }, properties: [{ id: 'custom.lineStyle', value: { fill: 'dash', dash: [8, 6] } }, { id: 'color', value: { mode: 'fixed', fixedColor: CRIT } }] }] }),
  ts('RabbitMQ messages waiting (rabbitmq_queue_messages_ready)', [
    [`sum by (queue) (rabbitmq_detailed_queue_messages_ready{${NS}, queue=~".*\\\\.events"})`, '{{queue}}'],
  ], { x: 12, y: 11, min: 0, description: 'analytics-service scales out when its queue backs up (target 20 per pod)' }),
  ts('Events processed / s per pod', [[`sum by (pod) (rate(events_consumed_total{${NS}, service=~"analytics-service|budget-service|notification-service"}[1m]))`, '{{pod}}']], { x: 0, y: 19, unit: 'ops' }),
  ts('CPU used / requested per pod', [[`sum by (pod) (rate(container_cpu_usage_seconds_total{${NS}, container!="", pod=~"(api-gateway|expense-service|analytics-service)-.*"}[2m])) / sum by (pod) (kube_pod_container_resource_requests{${NS}, resource="cpu", pod=~"(api-gateway|expense-service|analytics-service)-.*"})`, '{{pod}}']], { x: 12, y: 19, unit: 'percentunit', description: 'The HPA CPU target is 70% of the request' }),
], variables([hpaVar]), ['autoscaling']);

// ---------------------------------------------------------------- Infrastructure
const infra = dashboard('spendwise-infra', 'SpendWise · Infrastructure', 'Kubernetes nodes and pods, persistent storage, PostgreSQL and RabbitMQ.', [
  row('Cluster', 0),
  stat('Nodes ready', 'sum(kube_node_status_condition{condition="Ready", status="true"})', { x: 0, y: 1, thresholds: [{ color: CRIT, value: null }, { color: GOOD, value: 3 }] }),
  stat('Pods running', `sum(kube_pod_status_phase{${NS}, phase="Running"})`, { x: 4, y: 1 }),
  stat('Pods not ready', `sum(kube_pod_status_ready{${NS}, condition="false"}) or vector(0)`, { x: 8, y: 1, thresholds: [{ color: GOOD, value: null }, { color: WARN, value: 1 }, { color: CRIT, value: 3 }] }),
  stat('Restarts (1h)', `sum(increase(kube_pod_container_status_restarts_total{${NS}}[1h])) or vector(0)`, { x: 12, y: 1, decimals: 0, thresholds: [{ color: GOOD, value: null }, { color: WARN, value: 1 }, { color: CRIT, value: 5 }] }),
  stat('Cluster CPU used', '1 - avg(rate(node_cpu_seconds_total{mode="idle"}[2m]))', { x: 16, y: 1, unit: 'percentunit', decimals: 1, thresholds: [{ color: GOOD, value: null }, { color: WARN, value: 0.7 }, { color: CRIT, value: 0.9 }] }),
  stat('Cluster memory used', '1 - sum(node_memory_MemAvailable_bytes) / sum(node_memory_MemTotal_bytes)', { x: 20, y: 1, unit: 'percentunit', decimals: 1, thresholds: [{ color: GOOD, value: null }, { color: WARN, value: 0.75 }, { color: CRIT, value: 0.9 }] }),
  row('Nodes', 5),
  ts('CPU usage by node', [['1 - avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[2m]))', '{{instance}}']], { x: 0, y: 6, unit: 'percentunit', min: 0 }),
  ts('Memory used by node', [['node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes', '{{instance}}']], { x: 12, y: 6, unit: 'bytes', min: 0 }),
  row('Pods (namespace $namespace)', 14),
  ts('CPU by pod (top 10)', [[`topk(10, sum by (pod) (rate(container_cpu_usage_seconds_total{${NS}, container!=""}[2m])))`, '{{pod}}']], { x: 0, y: 15, unit: 'cores' }),
  ts('Memory working set by pod (top 10)', [[`topk(10, sum by (pod) (container_memory_working_set_bytes{${NS}, container!=""}))`, '{{pod}}']], { x: 12, y: 15, unit: 'bytes' }),
  ts('Network received / sent', [
    [`sum(rate(container_network_receive_bytes_total{${NS}}[2m]))`, 'received'],
    [`sum(rate(container_network_transmit_bytes_total{${NS}}[2m]))`, 'sent'],
  ], { x: 0, y: 23, unit: 'Bps' }),
  bar('Persistent volume claims (requested size)', `sum by (persistentvolumeclaim) (kube_persistentvolumeclaim_resource_requests_storage_bytes{${NS}})`, '{{persistentvolumeclaim}}', { x: 12, y: 23, unit: 'bytes' }),
  row('PostgreSQL (StatefulSet postgres-0)', 31),
  stat('PostgreSQL up', `max(pg_up{${NS}})`, { x: 0, y: 32, thresholds: [{ color: CRIT, value: null }, { color: GOOD, value: 1 }] }),
  stat('Connections', `sum(pg_stat_database_numbackends{${NS}})`, { x: 4, y: 32 }),
  ts('Connections by database', [[`sum by (datname) (pg_stat_database_numbackends{${NS}, datname!~"template.*|postgres"})`, '{{datname}}']], { x: 8, y: 32, w: 8, h: 8 }),
  bar('Database size', `sort_desc(pg_database_size_bytes{${NS}, datname!~"template.*"})`, '{{datname}}', { x: 16, y: 32, w: 8, h: 8, unit: 'bytes' }),
  ts('Transactions / s', [[`sum(rate(pg_stat_database_xact_commit{${NS}}[2m]))`, 'commits'], [`sum(rate(pg_stat_database_xact_rollback{${NS}}[2m]))`, 'rollbacks']], { x: 0, y: 36, w: 8, h: 4, unit: 'ops' }),
  row('RabbitMQ (StatefulSet rabbitmq-0)', 40),
  ts('Messages ready by queue', [[`sum by (queue) (rabbitmq_detailed_queue_messages_ready{${NS}})`, '{{queue}}']], { x: 0, y: 41, w: 12 }),
  ts('Messages published / delivered', [
    [`sum(rate(rabbitmq_global_messages_received_total{${NS}}[2m]))`, 'published'],
    [`sum(rate(rabbitmq_global_messages_delivered_total{${NS}}[2m]))`, 'delivered'],
  ], { x: 12, y: 41, w: 6, unit: 'ops' }),
  stat('Connections', `sum(rabbitmq_connections{${NS}})`, { x: 18, y: 41, w: 6, h: 4 }),
  stat('Dead-letter queue depth', `sum(rabbitmq_detailed_queue_messages_ready{${NS}, queue=~".*\\\\.dlq"}) or vector(0)`, { x: 18, y: 45, w: 6, h: 4, thresholds: [{ color: GOOD, value: null }, { color: CRIT, value: 1 }] }),
], variables(), ['infrastructure']);

mkdirSync('charts/monitoring-extras/dashboards', { recursive: true });
for (const [file, d] of [['spendwise-application.json', app], ['spendwise-autoscaling.json', autoscaling], ['spendwise-infrastructure.json', infra]]) {
  writeFileSync(`charts/monitoring-extras/dashboards/${file}`, `${JSON.stringify(d, null, 2)}\n`);
  console.log(`wrote ${file} (${d.panels.length} panels)`);
}
