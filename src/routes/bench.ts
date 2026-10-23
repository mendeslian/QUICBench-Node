import express from 'express';

import { env } from '../config/env.js';
import { getPayload, payloadSizes } from '../services/payload.service.js';

const benchRouter = express.Router();

benchRouter.get('/ping', (_req, res) => {
  res.json({ ok: true });
});

benchRouter.get('/payload/:size', (req, res) => {
  const payload = getPayload(req.params.size);

  if (!payload) {
    res.status(400).json({
      error: 'InvalidPayloadSize',
      allowed: payloadSizes,
    });
    return;
  }

  res.set('Content-Type', 'application/octet-stream');
  res.set('Content-Length', String(payload.length));
  res.end(payload);
});

const echoParser = express.raw({
  type: '*/*',
  limit: env.BENCH_MAX_BODY_BYTES,
});

benchRouter.post('/echo', echoParser, (req, res) => {
  const body = req.body;
  const bytes = Buffer.isBuffer(body) ? body.length : 0;

  res.json({ bytes });
});

export { benchRouter };
