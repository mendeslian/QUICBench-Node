import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ quiet: true });

function parseBooleanEnv(value: unknown, defaultValue: boolean): boolean {
  if (value === undefined || value === '') return defaultValue;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return ['true', '1', 'yes'].includes(value.toLowerCase());
  }
  return Boolean(value);
}

const EnvSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .optional()
      .default('development'),
    PORT: z.coerce.number().int().positive().optional().default(3000),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).optional().default(1),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .optional()
      .default('info'),
    RATE_LIMIT_WINDOW_MS: z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .default(60_000),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().optional().default(100),
    BENCHMARK_MODE: z
      .unknown()
      .optional()
      .transform((value) => parseBooleanEnv(value, false)),
    BENCH_MAX_BODY_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .default(2_097_152),
    METRICS_FILE: z.string().min(1).optional(),
  })
  .passthrough();

export type Env = z.infer<typeof EnvSchema>;

export function parseEnv(source: NodeJS.ProcessEnv): Env {
  return EnvSchema.parse(source);
}

export const env = parseEnv(process.env);
