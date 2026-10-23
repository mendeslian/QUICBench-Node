import { Counter } from 'k6/metrics';

const observedProto = new Counter('observed_proto');

const PROTO_URLS = {
  h1: () => __ENV.BASE_URL_H1 || 'http://localhost:3000',
  h2: () => __ENV.BASE_URL_H2 || 'https://localhost:8443',
};

export function resolveBaseUrl(proto) {
  const key = (proto || __ENV.PROTO || 'h1').toLowerCase();
  const resolver = PROTO_URLS[key];

  if (!resolver) {
    throw new Error(`Unsupported PROTO for k6: ${key}. Use h1 or h2.`);
  }

  return resolver();
}

export function buildOptions(overrides = {}) {
  const proto = (overrides.proto || __ENV.PROTO || 'h1').toLowerCase();
  const vus = Number(overrides.load ?? __ENV.LOAD ?? 50);
  const rampSec = Number(overrides.ramp ?? __ENV.RAMP ?? 10);
  const durationSec = Number(overrides.duration ?? __ENV.DURATION ?? 60);
  const baseUrl = resolveBaseUrl(proto);

  const options = {
    scenarios: {
      default: {
        executor: 'ramping-vus',
        startVUs: 0,
        stages: [
          { duration: `${rampSec}s`, target: vus },
          { duration: `${durationSec}s`, target: vus },
        ],
        gracefulRampDown: '5s',
      },
    },
    thresholds: {
      http_req_failed: ['rate<0.10'],
      http_req_duration: ['p(95)<10000'],
    },
  };

  if (proto === 'h2') {
    options.insecureSkipTLSVerify = true;
  }

  return { options, baseUrl, proto };
}

export function trackProto(res) {
  if (!res?.proto) {
    return;
  }

  observedProto.add(1, { proto: res.proto });
}

function percentile(values, p) {
  if (!values?.length) {
    return null;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[index];
}

function metricValue(metric, key) {
  return metric?.values?.[key] ?? null;
}

function buildTags() {
  return {
    proto: (__ENV.PROTO || 'h1').toLowerCase(),
    endpoint: __ENV.ENDPOINT || 'unknown',
    load: Number(__ENV.LOAD || 0),
    rep: Number(__ENV.REP || 0),
    seed: __ENV.SEED || '',
    network_profile: __ENV.NETWORK_PROFILE || 'clean',
    timestamp: new Date().toISOString(),
    tool: 'k6',
  };
}

function inferObservedProto(data) {
  const counter = data?.metrics?.observed_proto?.values;
  if (!counter) {
    return null;
  }

  const entries = Object.entries(counter).filter(([key]) => key !== 'count');
  if (!entries.length) {
    return null;
  }

  entries.sort((a, b) => b[1] - a[1]);
  const top = entries[0][0];
  const match = top.match(/proto:([^,}]+)/);
  return match ? match[1] : top;
}

export function extractMetrics(data) {
  const metrics = data?.metrics ?? {};

  return {
    http_req_duration_p50: metricValue(metrics.http_req_duration, 'p(50)'),
    http_req_duration_p90: metricValue(metrics.http_req_duration, 'p(90)'),
    http_req_duration_p95: metricValue(metrics.http_req_duration, 'p(95)'),
    http_req_duration_avg: metricValue(metrics.http_req_duration, 'avg'),
    http_req_waiting_p50: metricValue(metrics.http_req_waiting, 'p(50)'),
    http_req_waiting_p90: metricValue(metrics.http_req_waiting, 'p(90)'),
    http_req_waiting_p95: metricValue(metrics.http_req_waiting, 'p(95)'),
    http_reqs_rate: metricValue(metrics.http_reqs, 'rate'),
    http_reqs_count: metricValue(metrics.http_reqs, 'count'),
    data_received_rate: metricValue(metrics.data_received, 'rate'),
    data_sent_rate: metricValue(metrics.data_sent, 'rate'),
    http_req_failed_rate: metricValue(metrics.http_req_failed, 'rate'),
    iteration_duration_p95: metricValue(metrics.iteration_duration, 'p(95)'),
    observed_proto: inferObservedProto(data),
  };
}

export function handleSummary(data) {
  const tags = buildTags();
  const summary = {
    tags,
    metrics: extractMetrics(data),
  };

  const out = __ENV.OUT;
  if (out) {
    return { [out]: JSON.stringify(summary, null, 2) };
  }

  return { stdout: JSON.stringify(summary, null, 2) };
}

export { percentile };
