import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface SummaryTags {
  proto: string;
  endpoint: string;
  load: number;
  rep: number;
  seed?: string;
  network_profile?: string;
  timestamp?: string;
  tool?: string;
}

interface SummaryMetrics {
  http_req_duration_p50?: number | null;
  http_req_duration_p90?: number | null;
  http_req_duration_p95?: number | null;
  http_req_duration_avg?: number | null;
  http_req_waiting_p50?: number | null;
  http_req_waiting_p90?: number | null;
  http_req_waiting_p95?: number | null;
  http_reqs_rate?: number | null;
  http_reqs_count?: number | null;
  data_received_rate?: number | null;
  data_sent_rate?: number | null;
  http_req_failed_rate?: number | null;
  iteration_duration_p95?: number | null;
  observed_proto?: string | null;
}

interface RunSummary {
  tags: SummaryTags;
  metrics: SummaryMetrics;
}

interface AggregatedMetric {
  median: number | null;
  q1: number | null;
  q3: number | null;
  iqr: number | null;
  min: number | null;
  max: number | null;
  n: number;
}

interface AggregatedRow {
  proto: string;
  endpoint: string;
  load: number;
  network_profile: string;
  tool: string;
  replicas: number;
  metrics: Record<string, AggregatedMetric>;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const resultsRoot = resolve(__dirname, '..', 'results');

const CAMPAIGN_DIR_PATTERN = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/;

const METRIC_KEYS: (keyof SummaryMetrics)[] = [
  'http_req_duration_p50',
  'http_req_duration_p90',
  'http_req_duration_p95',
  'http_req_duration_avg',
  'http_req_waiting_p50',
  'http_req_waiting_p90',
  'http_req_waiting_p95',
  'http_reqs_rate',
  'http_reqs_count',
  'data_received_rate',
  'data_sent_rate',
  'http_req_failed_rate',
  'iteration_duration_p95',
];

function isRunSummary(value: unknown): value is RunSummary {
  if (!value || typeof value !== 'object') return false;
  const obj = value as RunSummary;
  return Boolean(obj.tags?.proto && obj.tags?.endpoint && obj.metrics);
}

function isCampaignDirName(name: string): boolean {
  return CAMPAIGN_DIR_PATTERN.test(name);
}

function listCampaignSubdirs(root: string): string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && isCampaignDirName(entry.name))
    .map((entry) => entry.name)
    .sort();
}

/** Pasta da campanha: argumento CLI, subpasta datada mais recente, ou raiz (layout legado). */
function resolveCampaignDir(): string {
  const arg = process.argv[2];
  if (arg) {
    return resolve(process.cwd(), arg);
  }

  mkdirSync(resultsRoot, { recursive: true });
  const subdirs = listCampaignSubdirs(resultsRoot);
  if (subdirs.length > 0) {
    return join(resultsRoot, subdirs[subdirs.length - 1]!);
  }

  return resultsRoot;
}

function loadSummaries(campaignDir: string): RunSummary[] {
  const files = readdirSync(campaignDir).filter(
    (f) => f.endsWith('.json') && !f.startsWith('summary'),
  );

  const summaries: RunSummary[] = [];
  for (const file of files) {
    try {
      const parsed = JSON.parse(
        readFileSync(join(campaignDir, file), 'utf8'),
      ) as unknown;
      if (isRunSummary(parsed)) {
        summaries.push(parsed);
      }
    } catch {
      // Ignora arquivos inválidos (ex.: metrics.ndjson legado).
    }
  }
  return summaries;
}

function percentile(sorted: number[], p: number): number {
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[index];
}

function aggregateValues(values: number[]): AggregatedMetric {
  if (!values.length) {
    return {
      median: null,
      q1: null,
      q3: null,
      iqr: null,
      min: null,
      max: null,
      n: 0,
    };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const q1 = percentile(sorted, 25);
  const q3 = percentile(sorted, 75);

  return {
    median: percentile(sorted, 50),
    q1,
    q3,
    iqr: q3 - q1,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    n: sorted.length,
  };
}

function networkProfileOf(summary: RunSummary): string {
  return summary.tags.network_profile ?? 'clean';
}

function toolOf(summary: RunSummary): string {
  return summary.tags.tool ?? 'k6';
}

function groupKey(summary: RunSummary): string {
  return `${summary.tags.proto}|${summary.tags.endpoint}|${summary.tags.load}|${networkProfileOf(summary)}|${toolOf(summary)}`;
}

function aggregate(summaries: RunSummary[]): AggregatedRow[] {
  const groups = new Map<string, RunSummary[]>();

  for (const summary of summaries) {
    const key = groupKey(summary);
    const list = groups.get(key) ?? [];
    list.push(summary);
    groups.set(key, list);
  }

  const rows: AggregatedRow[] = [];

  for (const [, runs] of groups) {
    const first = runs[0];
    const metrics: Record<string, AggregatedMetric> = {};

    for (const key of METRIC_KEYS) {
      const values = runs
        .map((run) => run.metrics[key])
        .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
      metrics[key] = aggregateValues(values);
    }

    rows.push({
      proto: first.tags.proto,
      endpoint: first.tags.endpoint,
      load: first.tags.load,
      network_profile: networkProfileOf(first),
      tool: toolOf(first),
      replicas: runs.length,
      metrics,
    });
  }

  rows.sort((a, b) =>
    `${a.tool}-${a.proto}-${a.endpoint}-${a.load}-${a.network_profile}`.localeCompare(
      `${b.tool}-${b.proto}-${b.endpoint}-${b.load}-${b.network_profile}`,
    ),
  );

  return rows;
}

function toCsv(rows: AggregatedRow[]): string {
  const header = [
    'proto',
    'endpoint',
    'load',
    'network_profile',
    'tool',
    'replicas',
    'metric',
    'median',
    'q1',
    'q3',
    'iqr',
    'min',
    'max',
    'n',
  ];

  const lines = [header.join(',')];

  for (const row of rows) {
    for (const [metric, stats] of Object.entries(row.metrics)) {
      if (stats.n === 0) continue;
      lines.push(
        [
          row.proto,
          row.endpoint,
          row.load,
          row.network_profile,
          row.tool,
          row.replicas,
          metric,
          stats.median,
          stats.q1,
          stats.q3,
          stats.iqr,
          stats.min,
          stats.max,
          stats.n,
        ].join(','),
      );
    }
  }

  return `${lines.join('\n')}\n`;
}

function main(): void {
  const campaignDir = resolveCampaignDir();
  mkdirSync(campaignDir, { recursive: true });
  const summaries = loadSummaries(campaignDir);

  if (!summaries.length) {
    console.error(
      `Nenhum summary JSON encontrado em ${campaignDir}. Execute npm run bench:run primeiro ou passe o caminho da campanha.`,
    );
    process.exit(1);
  }

  const rows = aggregate(summaries);
  const jsonPath = join(campaignDir, 'summary.json');
  const csvPath = join(campaignDir, 'summary.csv');

  writeFileSync(jsonPath, `${JSON.stringify(rows, null, 2)}\n`, 'utf8');
  writeFileSync(csvPath, toCsv(rows), 'utf8');

  console.log(`Campanha: ${campaignDir}`);
  console.log(`Agregados ${summaries.length} runs em ${rows.length} células.`);
  console.log(`JSON: ${jsonPath}`);
  console.log(`CSV:  ${csvPath}`);
}

main();
