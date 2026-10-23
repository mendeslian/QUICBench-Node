import express from 'express';

const healthRouter = express.Router();

healthRouter.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
  });
});

export { healthRouter };
