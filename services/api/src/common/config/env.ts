import { z } from "zod";

/**
 * Environment configuration schema with zod validation.
 * All required vars must be set; optional vars have defaults.
 */
const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),
  GITHUB_CLIENT_ID: z.string().min(1, "GITHUB_CLIENT_ID is required"),
  GITHUB_CLIENT_SECRET: z.string().min(1, "GITHUB_CLIENT_SECRET is required"),
  GITHUB_CALLBACK_URL: z.string().url("GITHUB_CALLBACK_URL must be a valid URL"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  JWT_REFRESH_SECRET: z
    .string()
    .min(32, "JWT_REFRESH_SECRET must be at least 32 characters"),
  S3_BUCKET: z.string().min(1, "S3_BUCKET is required"),
  S3_REGION: z.string().min(1, "S3_REGION is required"),
  CLAUDE_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GOOGLE_AI_API_KEY: z.string().optional(),
  PERPLEXITY_API_KEY: z.string().optional(),
  MISTRAL_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  DEEPSEEK_API_KEY: z.string().optional(),
  XAI_API_KEY: z.string().optional(),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  WORKER_URL: z.string().url().optional(),
  WORKER_SERVICE_TOKEN: z.string().optional(),
  GITHUB_WEBHOOK_SECRET: z.string().optional(),
  GITHUB_PAT: z.string().optional(),
  ENCRYPTION_KEY: z.string().min(32, "ENCRYPTION_KEY must be at least 32 hex characters (generate with: openssl rand -hex 32)"),
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | null = null;

/**
 * Load and validate environment variables.
 * Throws on first access if validation fails.
 */
export function getEnv(): Env {
  if (cachedEnv) return cachedEnv;
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Environment validation failed: ${issues}`);
  }
  cachedEnv = result.data;
  return cachedEnv;
}
