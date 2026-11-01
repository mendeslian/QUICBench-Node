import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Métricas usadas na frase de que HTTP/2 superou HTTP/3. */
export const COMPARED_METRICS = [
  'http_req_duration_p95',
  'http_reqs_rate',
] as const;

export type ComparedMetric = (typeof COMPARED_METRICS)[number];

export type PMethod = 'exact' | 'asymptotic';

interface SummaryTags {
  proto: string;
  endpoint: string;
  load: number;
  network_profile?: string;
}

interface RunSummary {
  tags: SummaryTags;
  metrics: Partial<Record<ComparedMetric, number | null>>;
}

export interface SampleComparison {
  nX: number;
  nY: number;
  /** U de Mann-Whitney da amostra X (pares X > Y, empate vale 0,5). */
  u: number;
  /** (pares X > Y − pares X < Y) / (nX * nY). Empate não entra. */
  cliffsDelta: number;
  p: number;
  pMethod: PMethod;
}

export interface ComparisonRow {
  endpoint: string;
  load: number;
  network_profile: string;
  metric: ComparedMetric;
  n_h2: number;
  n_h3: number;
  u_h2: number;
  cliffs_delta: number;
  p: number;
  p_method: PMethod;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const resultsRoot = resolve(__dirname, '..', 'results');

const CAMPAIGN_DIR_PATTERN = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/;

const ENDPOINT_ORDER = [
  'ping',
  'payload_1kb',
  'payload_100kb',
  'payload_1mb',
  'echo',
];

const PROFILE_ORDER = [
  'clean',
  'lag_100ms',
  'loss_1pct',
  'lag_100ms_loss_1pct',
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
    (f) =>
      f.endsWith('.json') &&
      !f.startsWith('summary') &&
      !f.startsWith('h2-h3-tests'),
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
      // Ignora JSON que não é summary de execução.
    }
  }
  return summaries;
}

function combination(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  const kk = Math.min(k, n - k);
  let result = 1;
  for (let i = 1; i <= kk; i++) {
    result = (result * (n - kk + i)) / i;
  }
  return result;
}

/** Número de maneiras de escolher n1 postos distintos em 1..N somando w. */
function rankSumCounts(n1: number, total: number): number[] {
  const maxSum = (n1 * (2 * total - n1 + 1)) / 2;
  let dp: number[][] = Array.from({ length: n1 + 1 }, () =>
    new Array<number>(maxSum + 1).fill(0),
  );
  dp[0]![0] = 1;

  for (let rank = 1; rank <= total; rank++) {
    const next = dp.map((row) => row.slice());
    for (let k = 1; k <= n1; k++) {
      const from = dp[k - 1]!;
      const dest = next[k]!;
      for (let sum = rank; sum <= maxSum; sum++) {
        dest[sum] += from[sum - rank] ?? 0;
      }
    }
    dp = next;
  }

  return dp[n1]!;
}

/**
 * Φ(z) pela aproximação de Hastings para erf (erro máximo cerca de 1,5e-7).
 * Abramowitz e Stegun, 7.1.26.
 */
function normalCdf(z: number): number {
  if (z < -8) return 0;
  if (z > 8) return 1;
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * x);
  const erf =
    sign *
    (1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x));
  return 0.5 * (1 + erf);
}

function tieCubeSum(values: number[]): number {
  const counts = new Map<number, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let sum = 0;
  for (const size of counts.values()) {
    if (size > 1) sum += size ** 3 - size;
  }
  return sum;
}

function asymptoticTwoSidedP(
  u: number,
  nX: number,
  nY: number,
  combined: number[],
): number {
  const total = nX + nY;
  const mean = (nX * nY) / 2;
  const variance =
    ((nX * nY) / 12) *
    (total + 1 - tieCubeSum(combined) / (total * (total - 1)));
  if (!(variance > 0)) return 1;

  const z = (Math.abs(u - mean) - 0.5) / Math.sqrt(variance);
  if (z <= 0) return 1;
  return Math.min(1, 2 * (1 - normalCdf(z)));
}

function exactTwoSidedP(u: number, nX: number, nY: number): number {
  const total = nX + nY;
  const ways = combination(total, nX);
  if (!Number.isSafeInteger(ways)) {
    throw new Error(
      `C(${total}, ${nX}) não cabe em inteiro seguro; use a aproximação normal.`,
    );
  }

  const counts = rankSumCounts(nX, total);
  const minRankSum = (nX * (nX + 1)) / 2;
  const mean = (nX * nY) / 2;
  const distance = Math.abs(u - mean);
  let extreme = 0;

  for (let rankSum = 0; rankSum < counts.length; rankSum++) {
    const count = counts[rankSum] ?? 0;
    if (count === 0) continue;
    const uAt = rankSum - minRankSum;
    if (Math.abs(uAt - mean) + 1e-9 >= distance) extreme += count;
  }

  return extreme / ways;
}

/**
 * Compara a amostra X com a amostra Y.
 * p exato se nenhum valor de X coincide com um valor de Y; caso contrário,
 * aproximação normal com correção de empate e de continuidade.
 */
export function compareSamples(x: number[], y: number[]): SampleComparison {
  if (x.length === 0 || y.length === 0) {
    throw new Error('Cada amostra precisa de ao menos uma observação.');
  }

  let greater = 0;
  let less = 0;
  let equal = 0;
  for (const left of x) {
    for (const right of y) {
      if (left > right) greater += 1;
      else if (left < right) less += 1;
      else equal += 1;
    }
  }

  const pairs = x.length * y.length;
  const u = greater + 0.5 * equal;
  const cliffsDelta = (greater - less) / pairs;
  const crossTie = equal > 0;
  const ways = combination(x.length + y.length, x.length);
  const exactFits = Number.isSafeInteger(ways);
  const pMethod: PMethod = crossTie || !exactFits ? 'asymptotic' : 'exact';
  const p =
    pMethod === 'exact'
      ? exactTwoSidedP(u, x.length, y.length)
      : asymptoticTwoSidedP(u, x.length, y.length, [...x, ...y]);

  return {
    nX: x.length,
    nY: y.length,
    u,
    cliffsDelta,
    p,
    pMethod,
  };
}

function networkProfileOf(summary: RunSummary): string {
  return summary.tags.network_profile ?? 'clean';
}

function finiteMetric(
  summary: RunSummary,
  metric: ComparedMetric,
): number | null {
  const value = summary.metrics[metric];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function orderIndex(list: readonly string[], value: string): number {
  const index = list.indexOf(value);
  return index === -1 ? list.length : index;
}

/**
 * Uma linha por condição (endpoint, carga, perfil) e métrica, HTTP/2 contra HTTP/3.
 * HTTP/1.1 fica de fora. Campanhas não são misturadas: o recorte é o do chamador.
 */
export function compareH2H3(summaries: RunSummary[]): ComparisonRow[] {
  const groups = new Map<string, { h2: RunSummary[]; h3: RunSummary[] }>();

  for (const summary of summaries) {
    if (summary.tags.proto !== 'h2' && summary.tags.proto !== 'h3') continue;
    const key = `${summary.tags.endpoint}|${summary.tags.load}|${networkProfileOf(summary)}`;
    const group = groups.get(key) ?? { h2: [], h3: [] };
    group[summary.tags.proto].push(summary);
    groups.set(key, group);
  }

  const rows: ComparisonRow[] = [];

  for (const [key, group] of groups) {
    const [endpoint, loadText, networkProfile] = key.split('|');
    const load = Number(loadText);
    for (const metric of COMPARED_METRICS) {
      const x = group.h2
        .map((run) => finiteMetric(run, metric))
        .filter((value): value is number => value !== null);
      const y = group.h3
        .map((run) => finiteMetric(run, metric))
        .filter((value): value is number => value !== null);
      if (x.length === 0 || y.length === 0) continue;

      const compared = compareSamples(x, y);
      rows.push({
        endpoint: endpoint!,
        load,
        network_profile: networkProfile!,
        metric,
        n_h2: compared.nX,
        n_h3: compared.nY,
        u_h2: compared.u,
        cliffs_delta: compared.cliffsDelta,
        p: compared.p,
        p_method: compared.pMethod,
      });
    }
  }

  rows.sort((a, b) => {
    const byEndpoint =
      orderIndex(ENDPOINT_ORDER, a.endpoint) -
      orderIndex(ENDPOINT_ORDER, b.endpoint);
    if (byEndpoint !== 0) return byEndpoint;
    if (a.load !== b.load) return a.load - b.load;
    const byProfile =
      orderIndex(PROFILE_ORDER, a.network_profile) -
      orderIndex(PROFILE_ORDER, b.network_profile);
    if (byProfile !== 0) return byProfile;
    return (
      COMPARED_METRICS.indexOf(a.metric) - COMPARED_METRICS.indexOf(b.metric)
    );
  });

  return rows;
}

function csvNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toPrecision(12)));
}

export function toCsv(rows: ComparisonRow[]): string {
  const header = [
    'endpoint',
    'load',
    'network_profile',
    'metric',
    'n_h2',
    'n_h3',
    'u_h2',
    'cliffs_delta',
    'p',
    'p_method',
  ];
  const lines = [header.join(',')];
  for (const row of rows) {
    lines.push(
      [
        row.endpoint,
        row.load,
        row.network_profile,
        row.metric,
        row.n_h2,
        row.n_h3,
        csvNumber(row.u_h2),
        csvNumber(row.cliffs_delta),
        csvNumber(row.p),
        row.p_method,
      ].join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}

function isCliEntry(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

function main(): void {
  const campaignDir = resolveCampaignDir();
  mkdirSync(campaignDir, { recursive: true });
  const summaries = loadSummaries(campaignDir);

  if (!summaries.length) {
    console.error(
      `Nenhum summary JSON encontrado em ${campaignDir}. Passe o caminho da campanha.`,
    );
    process.exit(1);
  }

  const rows = compareH2H3(summaries);
  if (!rows.length) {
    console.error(
      `Nenhum par HTTP/2 e HTTP/3 com as métricas comparadas em ${campaignDir}.`,
    );
    process.exit(1);
  }

  const jsonPath = join(campaignDir, 'h2-h3-tests.json');
  const csvPath = join(campaignDir, 'h2-h3-tests.csv');
  writeFileSync(jsonPath, `${JSON.stringify(rows, null, 2)}\n`, 'utf8');
  writeFileSync(csvPath, toCsv(rows), 'utf8');

  console.log(`Campanha: ${campaignDir}`);
  console.log(`Comparações H2×H3: ${rows.length}.`);
  console.log(`JSON: ${jsonPath}`);
  console.log(`CSV:  ${csvPath}`);
}

if (isCliEntry()) {
  main();
}
