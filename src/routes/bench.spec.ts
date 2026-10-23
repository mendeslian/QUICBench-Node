import { describe, expect, it } from '@jest/globals';
import request from 'supertest';

import {
  getPayloadByteLength,
  payloadSizes,
} from '../services/payload.service.js';
import { createTestApp } from '../../test/helpers/create-test-app.js';

describe('Bench routes — contrato HTTP', () => {
  const app = createTestApp();

  it('GET /bench/ping deve retornar resposta mínima constante', async () => {
    const res = await request(app).get('/bench/ping').expect(200);

    expect(res.body).toEqual({ ok: true });
  });

  it.each(payloadSizes)(
    'GET /bench/payload/%s deve retornar octet-stream com tamanho correto',
    async (size) => {
      const res = await request(app).get(`/bench/payload/${size}`).expect(200);

      expect(res.headers['content-type']).toMatch(/application\/octet-stream/);
      expect(Buffer.byteLength(res.body)).toBe(getPayloadByteLength(size));

      const contentLength = res.headers['content-length'];
      if (contentLength !== undefined) {
        expect(Number(contentLength)).toBe(getPayloadByteLength(size));
      }
    },
  );

  it('GET /bench/payload/tamanho-invalido deve retornar 400', async () => {
    const res = await request(app)
      .get('/bench/payload/tamanho-invalido')
      .expect(400);

    expect(res.body).toMatchObject({
      error: 'InvalidPayloadSize',
      allowed: payloadSizes,
    });
  });

  it('POST /bench/echo deve retornar quantidade de bytes recebidos', async () => {
    const body = Buffer.alloc(512, 0xab);

    const res = await request(app)
      .post('/bench/echo')
      .set('Content-Type', 'application/octet-stream')
      .send(body)
      .expect(200);

    expect(res.body).toEqual({ bytes: 512 });
  });
});
