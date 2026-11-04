import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** `std::chrono::duration<double>` em performance.request: segundos. */
export const H2LOAD_DURATION_TO_MS = 1000;

const DURATION_SECONDS_LIMIT = 1000;

export const OBSERVED_PROTO: Record<string, string> = {
  h1: 'HTTP/1.1',
  h2: 'HTTP/2.0',
  h3: 'HTTP/3',
};

interface SdStat {
  median?: number;
  p95?: number;
  mean?: number;
  samples?: number[];
}

interface H2LoadDocument {
  measurements?: {
    request_per_second?: number;
    bytes_per_second?: number;
    requests?: {
      total?: number;
      succeeded?: number;
      failed?: number;
    };
    performance?: {
      request?: SdStat;
    };
  };
}

export interface MapH2LoadInput {
  proto: string;
  endpoint: string;
  load: number;
  rep: number;
  seed?: string;
  networkProfile?: string;
  timestamp?: string;
}

export interface CampaignSummary {
  tags: {
    proto: string;
    endpoint: string;
    load: number;
    rep: number;
    seed: string;
    network_profile: string;
    timestamp: string;
    tool: 'h2load';
  };
  metrics: {
    http_req_duration_p50: number | null;
    http_req_duration_p90: number | null;
    http_req_duration_p95: number | null;
    http_req_duration_avg: number | null;
    http_req_waiting_p50: null;
    http_req_waiting_p90: null;
    http_req_waiting_p95: null;
    http_reqs_rate: number | null;
    http_reqs_count: number | null;
    data_received_rate: number | null;
    data_sent_rate: null;
    http_req_failed_rate: number | null;
    iteration_duration_p95: null;
    observed_proto: string;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function secondsToMs(value: number | null, field: string): number | null {
  if (value == null) return null;
  if (value > DURATION_SECONDS_LIMIT) {
    throw new Error(
      `${field}=${value} passa de ${DURATION_SECONDS_LIMIT}s; a unidade do JSON não é a de duration<double>`,
    );
  }
  return value * H2LOAD_DURATION_TO_MS;
}

/**
 * Mesmo índice de h2load.cc: samples[size_t(n * fraction)] no vetor ordenado.
 * fraction 0.95 é o p95 gravado no JSON; aqui serve para o p90, que o JSON não traz.
 */
export function h2loadSampleAt(
  samples: number[],
  fraction: number,
): number | null {
  if (!samples.length) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.trunc(sorted.length * fraction);
  if (index < 0 || index >= sorted.length) return null;
  return sorted[index] ?? null;
}

export function mapH2LoadDocument(
  document: unknown,
  input: MapH2LoadInput,
): CampaignSummary {
  if (!isRecord(document) || !isRecord(document.measurements)) {
    throw new Error('JSON do h2load sem measurements');
  }

  const measurements = document.measurements;
  const request = isRecord(measurements.performance)
    ? (measurements.performance.request as SdStat | undefined)
    : undefined;
  if (!request) {
    throw new Error('JSON do h2load sem performance.request');
  }

  const observed = OBSERVED_PROTO[input.proto];
  if (!observed) {
    throw new Error(`proto desconhecido: ${input.proto}`);
  }

  const requests = isRecord(measurements.requests) ? measurements.requests : {};
  const total = asNumber(requests.total);
  const failed = asNumber(requests.failed);
  const samples = Array.isArray(request.samples)
    ? request.samples.filter(
        (value): value is number => typeof value === 'number',
      )
    : [];
  const p90Seconds = h2loadSampleAt(samples, 0.9);

  return {
    tags: {
      proto: input.proto,
      endpoint: input.endpoint,
      load: input.load,
      rep: input.rep,
      seed: input.seed ?? '',
      network_profile: input.networkProfile ?? 'clean',
      timestamp: input.timestamp ?? new Date().toISOString(),
      tool: 'h2load',
    },
    metrics: {
      http_req_duration_p50: secondsToMs(asNumber(request.median), 'median'),
      http_req_duration_p90: secondsToMs(p90Seconds, 'p90'),
      http_req_duration_p95: secondsToMs(asNumber(request.p95), 'p95'),
      http_req_duration_avg: secondsToMs(asNumber(request.mean), 'mean'),
      http_req_waiting_p50: null,
      http_req_waiting_p90: null,
      http_req_waiting_p95: null,
      http_reqs_rate: asNumber(measurements.request_per_second),
      http_reqs_count: asNumber(requests.succeeded),
      data_received_rate: asNumber(measurements.bytes_per_second),
      data_sent_rate: null,
      http_req_failed_rate:
        total != null && total > 0 && failed != null ? failed / total : null,
      iteration_duration_p95: null,
      observed_proto: observed,
    },
  };
}

export function loadH2LoadDocument(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

function arg(name: string, fallback?: string): string {
  const prefixed = process.argv.find((item) => item.startsWith(`${name}=`));
  if (prefixed) return prefixed.slice(name.length + 1);

  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (value && !value.startsWith('--')) return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`faltou ${name}`);
}

function isCliEntry(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

function main(): void {
  const document = loadH2LoadDocument(arg('--raw'));
  const summary = mapH2LoadDocument(document, {
    proto: arg('--proto'),
    endpoint: arg('--endpoint'),
    load: Number(arg('--load')),
    rep: Number(arg('--rep')),
    seed: arg('--seed', ''),
    networkProfile: arg('--network-profile', 'clean'),
    timestamp: new Date().toISOString(),
  });

  const parsed = document as H2LoadDocument;
  const samples =
    parsed.measurements?.performance?.request?.samples?.length ?? 0;
  const succeeded = parsed.measurements?.requests?.succeeded ?? null;
  const p95 = parsed.measurements?.performance?.request?.p95 ?? null;
  console.log(
    `h2load map: samples=${samples} succeeded=${succeeded} p95_s=${p95} p95_ms=${summary.metrics.http_req_duration_p95} rate=${summary.metrics.http_reqs_rate}`,
  );

  writeFileSync(arg('--out'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
}

if (isCliEntry()) {
  main();
}
