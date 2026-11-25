import { describe, expect, it } from '@jest/globals';

import {
  CLOSED_LOOP_TOLERANCE,
  closedLoopProduct,
  evaluateRun,
  isClosedLoop,
} from './closed-loop.js';

describe('laço fechado: taxa × média = clientes', () => {
  it('fecha o GET de 1 MB em HTTP/1.1', () => {
    const product = closedLoopProduct(984, 51);
    expect(product).toBeCloseTo(50.184, 3);
    expect(isClosedLoop(50, product)).toBe(true);
  });

  it('marca o GET de 1 MB em HTTP/2', () => {
    const product = closedLoopProduct(555.82, 46.023907);
    expect(product).toBeCloseTo(25.58, 2);
    expect(isClosedLoop(50, product)).toBe(false);
  });

  it('aceita o intervalo de 2 clientes em torno da carga', () => {
    expect(CLOSED_LOOP_TOLERANCE).toBe(2);
    expect(isClosedLoop(50, 48)).toBe(true);
    expect(isClosedLoop(50, 52)).toBe(true);
    expect(isClosedLoop(50, 47.9)).toBe(false);
  });

  it('rejeita corrida sem média ou sem taxa', () => {
    const row = evaluateRun({
      tags: { proto: 'h2', endpoint: 'payload_1mb', load: 50, rep: 1 },
      metrics: { http_reqs_rate: 556, http_req_duration_avg: null },
    });
    expect(row.ok).toBe(false);
    expect(row.product).toBeNull();
  });
});
