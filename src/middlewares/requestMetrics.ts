import type { NextFunction, Request, Response } from 'express';

import { logger } from '../config/logger.js';
import { recordMetric } from '../services/metrics.service.js';

function chunkLength(chunk: unknown, encoding?: BufferEncoding): number {
  if (!chunk) return 0;
  if (Buffer.isBuffer(chunk)) return chunk.length;
  return Buffer.byteLength(String(chunk), encoding ?? 'utf8');
}

export function requestMetrics(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const start = process.hrtime.bigint();
  let bytesSent = 0;

  const originalWriteHead = res.writeHead.bind(res);
  const originalWrite = res.write.bind(res);
  const originalEnd = res.end.bind(res);

  res.writeHead = function writeHeadOverride(
    ...args: Parameters<typeof res.writeHead>
  ): Response {
    if (!res.headersSent) {
      const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
      res.setHeader('Server-Timing', `app;dur=${durationMs.toFixed(3)}`);
    }

    return originalWriteHead(...args);
  } as typeof res.writeHead;

  res.write = function writeOverride(
    chunk: unknown,
    encodingOrCb?: BufferEncoding | (() => void),
    cb?: () => void,
  ): boolean {
    const enc =
      typeof encodingOrCb === 'string' ? encodingOrCb : undefined;
    bytesSent += chunkLength(chunk, enc ?? 'utf8');
    if (typeof encodingOrCb === 'function') {
      return originalWrite(chunk, encodingOrCb);
    }
    if (encodingOrCb !== undefined) {
      return originalWrite(chunk, encodingOrCb, cb);
    }
    return originalWrite(chunk, cb);
  } as typeof res.write;

  res.end = function endOverride(
    chunk?: unknown,
    encodingOrCb?: BufferEncoding | (() => void),
    cb?: () => void,
  ): Response {
    const enc =
      typeof encodingOrCb === 'string' ? encodingOrCb : undefined;
    bytesSent += chunkLength(chunk, enc ?? 'utf8');
    if (typeof encodingOrCb === 'function') {
      return originalEnd(chunk, encodingOrCb);
    }
    if (encodingOrCb !== undefined) {
      return originalEnd(chunk, encodingOrCb, cb);
    }
    return originalEnd(chunk, cb);
  } as typeof res.end;

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    const log = req?.log ?? logger;
    const metricData = {
      method: req.method,
      path: req.originalUrl,
      protocol: `HTTP/${req.httpVersion}`,
      statusCode: res.statusCode,
      durationMs,
      bytesSent,
    };

    log.info(metricData, 'metricas_requisicao');

    recordMetric({
      timestamp: new Date().toISOString(),
      ...metricData,
    });
  });

  next();
}
