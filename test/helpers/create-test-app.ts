import type { Application } from 'express';

import { createApp } from '../../src/app.js';

export function createTestApp(): Application {
  return createApp();
}
