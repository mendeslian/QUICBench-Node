import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { NextFunction, Request, Response } from 'express';

import { errorHandler } from './errorHandler.js';

function createMockResponse() {
  const res = {
    headersSent: false,
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
    body: { error: string } | undefined;
  };
}

function createMockRequest() {
  return {
    log: { error: jest.fn() },
  } as unknown as Request;
}

describe('ErrorHandler — contrato de resposta de erro', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('deve retornar status 400 para erros do cliente', () => {
    const err = Object.assign(new Error('Dados inválidos'), { statusCode: 400 });
    const req = createMockRequest();
    const res = createMockResponse();
    const next = jest.fn() as NextFunction;

    errorHandler(err, req, res, next);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Dados inválidos' });
  });

  it('deve ocultar mensagem de erro 500 em produção', () => {
    process.env.NODE_ENV = 'production';

    const err = new Error('Detalhe interno sensível');
    const req = createMockRequest();
    const res = createMockResponse();
    const next = jest.fn() as NextFunction;

    errorHandler(err, req, res, next);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'InternalServerError' });
  });

  it('deve expor mensagem de erro 500 em desenvolvimento', () => {
    process.env.NODE_ENV = 'development';

    const err = new Error('Detalhe interno');
    const req = createMockRequest();
    const res = createMockResponse();
    const next = jest.fn() as NextFunction;

    errorHandler(err, req, res, next);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Detalhe interno' });
  });

  it('não deve enviar resposta dupla quando headers já foram enviados', () => {
    const err = new Error('Erro tardio');
    const req = createMockRequest();
    const res = createMockResponse();
    res.headersSent = true;
    const next = jest.fn() as NextFunction;

    errorHandler(err, req, res, next);

    expect(next).toHaveBeenCalledWith(err);
    expect(res.body).toBeUndefined();
  });
});
