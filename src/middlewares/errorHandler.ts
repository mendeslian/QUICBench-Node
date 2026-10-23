import type { NextFunction, Request, Response } from 'express';

export interface HttpError extends Error {
  statusCode?: number;
  status?: number;
}

export function errorHandler(
  err: HttpError,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(err);
    return;
  }

  const statusCode = Number(err?.statusCode ?? err?.status ?? 500);
  const message =
    statusCode >= 500 && process.env.NODE_ENV === 'production'
      ? 'InternalServerError'
      : err?.message || 'InternalServerError';

  if (req?.log?.error) {
    req.log.error({ err, statusCode }, 'erro_requisicao');
  }

  res.status(statusCode).json({ error: message });
}
