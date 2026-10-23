import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { env } from '../config/env.js';

export interface MetricEntry {
  timestamp: string;
  method: string;
  path: string;
  protocol: string;
  statusCode: number;
  durationMs: number;
  bytesSent: number;
}

export function recordMetric(entry: MetricEntry): void {
  if (!env.METRICS_FILE) {
    return;
  }

  try {
    mkdirSync(dirname(env.METRICS_FILE), { recursive: true });
    appendFileSync(env.METRICS_FILE, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch {
    // Export opcional: falha de I/O não deve interromper a API.
  }
}
