import { describe, expect, it } from '@jest/globals';
import request from 'supertest';

import { createTestApp } from './helpers/create-test-app.js';

describe('App (e2e) — contrato HTTP', () => {
  const app = createTestApp();

  it('GET /health deve retornar status ok com timestamp ISO', async () => {
    const res = await request(app).get('/health').expect(200);

    expect(res.body).toMatchObject({ status: 'ok' });
    expect(typeof res.body.time).toBe('string');
    expect(Number.isNaN(Date.parse(res.body.time))).toBe(false);
  });

  it('GET /rota-inexistente deve retornar 404 com shape esperado', async () => {
    const res = await request(app).get('/rota-inexistente').expect(404);

    expect(res.body).toEqual({
      error: 'NotFound',
      path: '/rota-inexistente',
    });
  });
});
