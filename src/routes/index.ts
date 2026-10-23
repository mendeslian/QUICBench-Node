import express from 'express';

import { healthRouter } from './health.js';
import { benchRouter } from './bench.js';

const routes = express.Router();

routes.use('/health', healthRouter);
routes.use('/bench', benchRouter);

export { routes };
