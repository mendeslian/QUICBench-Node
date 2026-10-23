import { describe, expect, it } from '@jest/globals';

import { ZodError } from 'zod';

import { parseEnv } from './env.js';

describe('Env — contrato de validação', () => {
  it('deve aplicar valores padrão quando variáveis estão ausentes', () => {
    const result = parseEnv({});

    expect(result.NODE_ENV).toBe('development');
    expect(result.PORT).toBe(3000);
    expect(result.TRUST_PROXY_HOPS).toBe(1);
    expect(result.LOG_LEVEL).toBe('info');
    expect(result.RATE_LIMIT_WINDOW_MS).toBe(60_000);
    expect(result.RATE_LIMIT_MAX).toBe(100);
    expect(result.BENCHMARK_MODE).toBe(false);
    expect(result.BENCH_MAX_BODY_BYTES).toBe(2_097_152);
    expect(result.METRICS_FILE).toBeUndefined();
  });

  it('deve converter strings numéricas para números', () => {
    const result = parseEnv({
      PORT: '8080',
      TRUST_PROXY_HOPS: '2',
      RATE_LIMIT_WINDOW_MS: '30000',
      RATE_LIMIT_MAX: '50',
    });

    expect(result.PORT).toBe(8080);
    expect(result.TRUST_PROXY_HOPS).toBe(2);
    expect(result.RATE_LIMIT_WINDOW_MS).toBe(30_000);
    expect(result.RATE_LIMIT_MAX).toBe(50);
  });

  it('deve rejeitar PORT inválido', () => {
    expect(() => parseEnv({ PORT: '-1' })).toThrow(ZodError);
  });

  it('deve rejeitar LOG_LEVEL inválido', () => {
    expect(() => parseEnv({ LOG_LEVEL: 'invalid' })).toThrow(ZodError);
  });

  it('deve interpretar BENCHMARK_MODE como booleano', () => {
    expect(parseEnv({ BENCHMARK_MODE: 'true' }).BENCHMARK_MODE).toBe(true);
    expect(parseEnv({ BENCHMARK_MODE: '1' }).BENCHMARK_MODE).toBe(true);
    expect(parseEnv({ BENCHMARK_MODE: 'false' }).BENCHMARK_MODE).toBe(false);
    expect(parseEnv({ BENCHMARK_MODE: '0' }).BENCHMARK_MODE).toBe(false);
  });

  it('deve aceitar METRICS_FILE e BENCH_MAX_BODY_BYTES opcionais', () => {
    const result = parseEnv({
      METRICS_FILE: 'benchmarks/results/metrics.ndjson',
      BENCH_MAX_BODY_BYTES: '1048576',
    });

    expect(result.METRICS_FILE).toBe('benchmarks/results/metrics.ndjson');
    expect(result.BENCH_MAX_BODY_BYTES).toBe(1_048_576);
  });
});
