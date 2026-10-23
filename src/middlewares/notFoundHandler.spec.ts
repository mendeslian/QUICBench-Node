import { describe, expect, it } from '@jest/globals';

import type { Request, Response } from 'express';

import { notFoundHandler } from './notFoundHandler.js';

function createMockResponse() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };

  return res as unknown as Response & {
    statusCode: number;
    body: { error: string; path: string } | undefined;
  };
}

describe('NotFoundHandler — contrato de rota inexistente', () => {
  it('deve retornar 404 com error e path', () => {
    const req = { originalUrl: '/rota-inexistente' } as Request;
    const res = createMockResponse();

    notFoundHandler(req, res);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({
      error: 'NotFound',
      path: '/rota-inexistente',
    });
  });
});
