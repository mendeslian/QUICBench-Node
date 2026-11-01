import { describe, expect, it } from '@jest/globals';

import { compareH2H3, compareSamples } from './compare-h2-h3.js';

describe('Mann-Whitney e delta de Cliff (HTTP/2 contra HTTP/3)', () => {
  it('separa as amostras por completo: δ = -1 e U = 0', () => {
    const result = compareSamples([1, 2, 3], [4, 5, 6]);

    expect(result.u).toBe(0);
    expect(result.cliffsDelta).toBe(-1);
    expect(result.pMethod).toBe('exact');
    // C(6, 3) = 20; só o posto mínimo e o máximo são tão extremos. p = 2/20.
    expect(result.p).toBe(0.1);
  });

  it('inverte a separação: δ = 1 e U = nX*nY', () => {
    const result = compareSamples([4, 5, 6], [1, 2, 3]);

    expect(result.u).toBe(9);
    expect(result.cliffsDelta).toBe(1);
    expect(result.pMethod).toBe('exact');
    expect(result.p).toBe(0.1);
  });

  it('calcula o p exato de um caso enumerado à mão (n = 3)', () => {
    // Pares de [1, 2, 4] com [3, 5, 6]: só (4, 3) tem X > Y. δ = (1-8)/9.
    // U = 1. |U - 4,5| >= 3,5 cobre U em {0, 1, 8, 9}: 4 das 20 atribuições.
    const result = compareSamples([1, 2, 4], [3, 5, 6]);

    expect(result.u).toBe(1);
    expect(result.cliffsDelta).toBeCloseTo(-7 / 9, 12);
    expect(result.pMethod).toBe('exact');
    expect(result.p).toBe(0.2);
  });

  it('calcula o p exato com n = 10 sem empate entre as amostras', () => {
    const http2 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const http3 = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
    const result = compareSamples(http2, http3);

    expect(result.u).toBe(0);
    expect(result.cliffsDelta).toBe(-1);
    expect(result.pMethod).toBe('exact');
    // C(20, 10) = 184756. Duas atribuições atingem os extremos.
    expect(result.p).toBe(2 / 184756);
  });

  it('trata amostras idênticas como empate: δ = 0', () => {
    const same = compareSamples([1, 2, 3], [1, 2, 3]);
    const flat = compareSamples([5, 5], [5, 5]);

    expect(same.cliffsDelta).toBe(0);
    expect(same.u).toBe(4.5);
    expect(same.pMethod).toBe('asymptotic');
    expect(same.p).toBe(1);

    expect(flat.cliffsDelta).toBe(0);
    expect(flat.u).toBe(2);
    expect(flat.pMethod).toBe('asymptotic');
    expect(flat.p).toBe(1);
  });

  it('corrige empate entre as amostras na conta de U e de δ', () => {
    // [1, 2, 2] contra [2, 3, 4]: 0 pares com X > Y, 7 com X < Y, 2 empates.
    // U = 0 + 0,5*2 = 1. δ = -7/9.
    // Variância = 4,65; z = 3/sqrt(4,65) com correção de continuidade.
    const result = compareSamples([1, 2, 2], [2, 3, 4]);
    const sigma = Math.sqrt(4.65);
    const z = 3 / sigma;
    const expectedP = twoSidedNormal(z);

    expect(result.u).toBe(1);
    expect(result.cliffsDelta).toBeCloseTo(-7 / 9, 12);
    expect(result.pMethod).toBe('asymptotic');
    expect(result.p).toBeCloseTo(expectedP, 6);
    expect(result.p).toBeGreaterThan(0.15);
    expect(result.p).toBeLessThan(0.18);
  });

  it('compara só HTTP/2 e HTTP/3, por condição e métrica', () => {
    const rows = compareH2H3([
      run('h1', 'ping', 50, 'clean', 1, 10),
      run('h2', 'ping', 50, 'clean', 10, 100),
      run('h2', 'ping', 50, 'clean', 11, 110),
      run('h3', 'ping', 50, 'clean', 30, 40),
      run('h3', 'ping', 50, 'clean', 31, 41),
      run('h2', 'ping', 50, 'lag_100ms', 20, 80),
      run('h3', 'ping', 50, 'lag_100ms', 50, 20),
    ]);

    expect(rows.map((row) => row.network_profile)).toEqual([
      'clean',
      'clean',
      'lag_100ms',
      'lag_100ms',
    ]);
    expect(rows.map((row) => row.metric)).toEqual([
      'http_req_duration_p95',
      'http_reqs_rate',
      'http_req_duration_p95',
      'http_reqs_rate',
    ]);
    expect(rows[0]).toMatchObject({
      n_h2: 2,
      n_h3: 2,
      u_h2: 0,
      cliffs_delta: -1,
      p_method: 'exact',
    });
    expect(rows[1]).toMatchObject({
      u_h2: 4,
      cliffs_delta: 1,
    });
  });
});

function run(
  proto: string,
  endpoint: string,
  load: number,
  networkProfile: string,
  p95: number,
  rate: number,
) {
  return {
    tags: {
      proto,
      endpoint,
      load,
      network_profile: networkProfile,
    },
    metrics: {
      http_req_duration_p95: p95,
      http_reqs_rate: rate,
    },
  };
}

/** Φ independente do módulo, para o caso com empate. */
function twoSidedNormal(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-x * x);
  const cdf = 0.5 * (1 + erf);
  return 2 * (1 - cdf);
}
