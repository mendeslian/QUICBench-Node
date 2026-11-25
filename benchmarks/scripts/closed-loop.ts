import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** |taxa × média − clientes| aceito. Em 50 clientes, o intervalo é 48 a 52. */
export const CLOSED_LOOP_TOLERANCE = 2;

interface SummaryTags {
  proto: string;
  endpoint: string;
  load: number;
  rep: number;
}

interface SummaryMetrics {
  http_req_duration_avg?: number | null;
  http_reqs_rate?: number | null;
}

interface RunSummary {
  tags: SummaryTags;
  metrics: SummaryMetrics;
}

export interface ClosedLoopRow {
  proto: string;
  endpoint: string;
  load: number;
  rep: number;
  rate: number | null;
  avgMs: number | null;
  product: number | null;
  ok: boolean;
}

export function closedLoopProduct(rate: number, avgMs: number): number {
  return (rate * avgMs) / 1000;
}

export function isClosedLoop(
  load: number,
  product: number,
  tolerance = CLOSED_LOOP_TOLERANCE,
): boolean {
  return Math.abs(product - load) <= tolerance;
}

export function evaluateRun(summary: RunSummary): ClosedLoopRow {
  const rate = summary.metrics.http_reqs_rate;
  const avgMs = summary.metrics.http_req_duration_avg;
  const hasNumbers =
    typeof rate === 'number' &&
    Number.isFinite(rate) &&
    typeof avgMs === 'number' &&
    Number.isFinite(avgMs);

  const product = hasNumbers ? closedLoopProduct(rate, avgMs) : null;

  return {
    proto: summary.tags.proto,
    endpoint: summary.tags.endpoint,
    load: summary.tags.load,
    rep: summary.tags.rep,
    rate: hasNumbers ? rate : null,
    avgMs: hasNumbers ? avgMs : null,
    product,
    ok: product != null && isClosedLoop(summary.tags.load, product),
  };
}

function isRunSummary(value: unknown): value is RunSummary {
  if (!value || typeof value !== 'object') return false;
  const obj = value as RunSummary;
  return Boolean(
    obj.tags?.proto && obj.tags?.endpoint && typeof obj.tags.load === 'number',
  );
}

export function loadRunSummaries(campaignDir: string): RunSummary[] {
  const files = readdirSync(campaignDir)
    .filter((name) => name.endsWith('.json') && !name.startsWith('summary'))
    .sort();

  const summaries: RunSummary[] = [];
  for (const file of files) {
    try {
      const parsed = JSON.parse(
        readFileSync(join(campaignDir, file), 'utf8'),
      ) as unknown;
      if (isRunSummary(parsed) && parsed.metrics) {
        summaries.push(parsed);
      }
    } catch {
      // Ignora JSON que não é summary de corrida (campaign.json, por exemplo).
    }
  }
  return summaries;
}

function formatCell(value: number | null): string {
  return value == null ? '' : value.toFixed(4);
}

export function toCsv(rows: ClosedLoopRow[]): string {
  const header = [
    'proto',
    'endpoint',
    'load',
    'rep',
    'rate',
    'avg_ms',
    'product',
    'ok',
  ];
  const lines = [header.join(',')];
  for (const row of rows) {
    lines.push(
      [
        row.proto,
        row.endpoint,
        row.load,
        row.rep,
        formatCell(row.rate),
        formatCell(row.avgMs),
        formatCell(row.product),
        row.ok ? '1' : '0',
      ].join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}

function argValue(name: string): string | undefined {
  const prefixed = process.argv.find((item) => item.startsWith(`${name}=`));
  if (prefixed) return prefixed.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (value && !value.startsWith('--')) return value;
  return undefined;
}

function main(): void {
  const campaignArg = process.argv.slice(2).find((item) => !item.startsWith('--'));
  if (!campaignArg) {
    console.error(
      'Uso: tsx benchmarks/scripts/closed-loop.ts <campanha> [--strict]',
    );
    process.exit(1);
  }

  const campaignDir = resolve(process.cwd(), campaignArg);
  const rows = loadRunSummaries(campaignDir).map(evaluateRun);
  if (!rows.length) {
    console.error(`Nenhum summary JSON em ${campaignDir}`);
    process.exit(1);
  }

  rows.sort((a, b) =>
    `${a.endpoint}|${a.proto}|${String(a.load).padStart(4, '0')}|${String(a.rep).padStart(3, '0')}`.localeCompare(
      `${b.endpoint}|${b.proto}|${String(b.load).padStart(4, '0')}|${String(b.rep).padStart(3, '0')}`,
    ),
  );

  const failed = rows.filter((row) => !row.ok);
  const csvPath = join(campaignDir, 'closed-loop.csv');
  writeFileSync(csvPath, toCsv(rows), 'utf8');

  console.log(`Campanha: ${campaignDir}`);
  console.log(`Corridas: ${rows.length}. Fora do laço: ${failed.length}.`);
  console.log(`CSV: ${csvPath}`);
  for (const row of failed) {
    const product = row.product == null ? 'sem média ou taxa' : row.product.toFixed(2);
    console.log(
      `FORA  ${row.proto} ${row.endpoint} load=${row.load} r${row.rep} produto=${product} clientes=${row.load}`,
    );
  }

  const strict =
    process.argv.includes('--strict') || argValue('--strict') === 'true';
  if (strict && failed.length > 0) {
    process.exit(1);
  }
}

function isCliEntry(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (isCliEntry()) {
  main();
}
