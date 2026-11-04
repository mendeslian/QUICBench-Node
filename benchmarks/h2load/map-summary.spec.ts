import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from '@jest/globals';

import { h2loadSampleAt, mapH2LoadDocument } from './map-summary.js';

const input = {
  proto: 'h2',
  endpoint: 'ping',
  load: 10,
  rep: 1,
  seed: 'abc',
  networkProfile: 'clean',
  timestamp: '2026-11-02T00:00:00.000Z',
};

describe('mapH2LoadDocument', () => {
  it('converte segundos em ms e deixa o TTFB por requisição vazio', () => {
    const summary = mapH2LoadDocument(
      {
        measurements: {
          request_per_second: 100,
          bytes_per_second: 1234,
          requests: { total: 502, succeeded: 500, failed: 2 },
          performance: {
            request: {
              median: 0.01,
              p95: 0.02,
              mean: 0.015,
              samples: [0.04, 0.005, 0.01, 0.02],
            },
          },
        },
      },
      input,
    );

    expect(summary.tags).toEqual({
      proto: 'h2',
      endpoint: 'ping',
      load: 10,
      rep: 1,
      seed: 'abc',
      network_profile: 'clean',
      timestamp: '2026-11-02T00:00:00.000Z',
      tool: 'h2load',
    });
    expect(summary.metrics.http_req_duration_p50).toBe(10);
    expect(summary.metrics.http_req_duration_p95).toBe(20);
    expect(summary.metrics.http_req_duration_avg).toBe(15);
    // n=4, floor(4 * 0.9) = 3, amostra ordenada 0.04 s.
    expect(summary.metrics.http_req_duration_p90).toBe(40);
    expect(summary.metrics.http_reqs_rate).toBe(100);
    expect(summary.metrics.http_reqs_count).toBe(500);
    expect(summary.metrics.data_received_rate).toBe(1234);
    expect(summary.metrics.data_sent_rate).toBeNull();
    expect(summary.metrics.http_req_failed_rate).toBeCloseTo(2 / 502);
    expect(summary.metrics.http_req_waiting_p50).toBeNull();
    expect(summary.metrics.http_req_waiting_p95).toBeNull();
    expect(summary.metrics.iteration_duration_p95).toBeNull();
    expect(summary.metrics.observed_proto).toBe('HTTP/2.0');
  });

  it('recusa mediana que não cabe em segundos', () => {
    expect(() =>
      mapH2LoadDocument(
        {
          measurements: {
            performance: {
              request: { median: 50000000, p95: 1, mean: 1, samples: [] },
            },
          },
        },
        input,
      ),
    ).toThrow(/unidade/);
  });

  it('usa o índice truncado do h2load no vetor ordenado', () => {
    expect(h2loadSampleAt([0.04, 0.005, 0.01, 0.02], 0.9)).toBe(0.04);
    expect(h2loadSampleAt([], 0.9)).toBeNull();
  });
});

const capturedPath = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'h2load-output.json',
);

describe('JSON capturado do binário', () => {
  const hasCapture = existsSync(capturedPath);

  (hasCapture ? it : it.skip)(
    'mapeia o --output-file gravado pelo h2load da imagem',
    () => {
      const document = JSON.parse(readFileSync(capturedPath, 'utf8')) as {
        measurements: {
          performance: { request: { p95: number; samples: number[] } };
          requests: { succeeded: number };
        };
      };
      const summary = mapH2LoadDocument(document, {
        ...input,
        proto: 'h3',
      });

      expect(summary.metrics.observed_proto).toBe('HTTP/3');
      expect(summary.metrics.http_req_duration_p95).toBeCloseTo(
        document.measurements.performance.request.p95 * 1000,
      );
      expect(summary.metrics.http_reqs_count).toBe(
        document.measurements.requests.succeeded,
      );
      expect(summary.metrics.http_req_waiting_p95).toBeNull();
      expect(
        document.measurements.performance.request.samples.length,
      ).toBeGreaterThan(0);
    },
  );
});
