import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
  MONGODB_URI: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_REFRESH_TTL: z.string().default('7d'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_SECURE: z.coerce.boolean().optional(),
  SMTP_FROM: z.string().optional(),
  ALLOW_PUBLIC_REGISTER: z.coerce.boolean().default(false),
  API_URL: z.string().url().optional(),
});

export type Env = z.infer<typeof envSchema>;

export const validateEnv = (cfg: Record<string, unknown>): Env => {
  const result = envSchema.safeParse(cfg);
  if (!result.success) {
    const flat = result.error.flatten();
    throw new Error(`Invalid environment: ${JSON.stringify(flat.fieldErrors)}`);
  }
  return result.data;
};
