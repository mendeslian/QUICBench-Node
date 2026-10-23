import compression from 'compression';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import { env } from './config/env.js';
import { errorHandler } from './middlewares/errorHandler.js';
import { notFoundHandler } from './middlewares/notFoundHandler.js';
import { requestLogger } from './middlewares/requestLogger.js';
import { requestMetrics } from './middlewares/requestMetrics.js';
import { routes } from './routes/index.js';

export function createApp(): express.Application {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY_HOPS);

  app.use(requestLogger);
  app.use(requestMetrics);
  app.use(helmet());
  app.use(cors());
  app.use(
    compression({
      filter: (req, res) => {
        if (req.path.startsWith('/bench/payload')) {
          return false;
        }

        return compression.filter(req, res);
      },
    }),
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  app.use(
    rateLimit({
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      max: env.RATE_LIMIT_MAX,
      standardHeaders: true,
      legacyHeaders: false,
      skip: () => env.BENCHMARK_MODE,
    }),
  );

  app.use(routes);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
