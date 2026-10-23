import 'dotenv/config';
import { createServer } from 'node:http';

import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';

const app = createApp();
const server = createServer(app);

server.listen(env.PORT, '0.0.0.0', () => {
  logger.info({ port: env.PORT }, 'Servidor em execução');
});
