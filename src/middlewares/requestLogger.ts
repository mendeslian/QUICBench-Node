import { pinoHttp } from 'pino-http';

import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

export const requestLogger = pinoHttp({
  logger,
  autoLogging: !env.BENCHMARK_MODE,
  customReceivedMessage: () => 'requisição recebida',
  customSuccessMessage: () => 'requisição concluída',
  customErrorMessage: () => 'requisição com erro',
});
