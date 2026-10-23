import { pinoHttp } from 'pino-http';

import { logger } from '../config/logger.js';

export const requestLogger = pinoHttp({
  logger,
  customReceivedMessage: () => 'requisição recebida',
  customSuccessMessage: () => 'requisição concluída',
  customErrorMessage: () => 'requisição com erro',
});
