import { z } from "zod";

const booleanFromString = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

const sharedEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  AWS_REGION: z.string().min(1).default("us-west-2"),
  SPEC2PROOF_MODEL_ID: z
    .string()
    .min(1)
    .default("global.anthropic.claude-sonnet-4-6"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

const githubLimitsSchema = z.object({
  SPEC2PROOF_MAX_CHANGED_FILES: z.coerce.number().int().min(1).max(500).default(100),
  SPEC2PROOF_MAX_PATCH_CHARS_PER_FILE: z.coerce
    .number()
    .int()
    .min(256)
    .max(20_000)
    .default(4_000),
});

export const webhookEnvSchema = sharedEnvSchema
  .extend({
    WEBHOOK_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    GITHUB_WEBHOOK_SECRET: z.string().min(16),
    GITHUB_APP_ID: z.coerce.number().int().positive(),
    GITHUB_PRIVATE_KEY: z
      .string()
      .min(32)
      .transform((value) => value.replace(/\\n/gu, "\n").trim()),
    GITHUB_API_URL: z
      .string()
      .url()
      .default("https://api.github.com")
      .transform(stripTrailingSlash),
    SPEC2PROOF_AGENT_RUNTIME_URL: z
      .string()
      .url()
      .default("http://127.0.0.1:8080/invocations"),
    SPEC2PROOF_AGENT_RUNTIME_TIMEOUT_SECONDS: z.coerce
      .number()
      .int()
      .min(30)
      .max(1_800)
      .default(900),
  })
  .and(githubLimitsSchema);

export const agentRuntimeEnvSchema = sharedEnvSchema.extend({
  AGENT_RUNTIME_PORT: z.coerce.number().int().min(1).max(65_535).default(8080),
  SPEC2PROOF_ALLOWED_HOSTS: z
    .string()
    .min(1)
    .transform((value) =>
      value
        .split(",")
        .map((host) => host.trim().toLowerCase())
        .filter(Boolean),
    ),
  SPEC2PROOF_ALLOW_HTTP: booleanFromString.default(false),
  SPEC2PROOF_ALLOW_PRIVATE_HOSTS: booleanFromString.default(false),
  SPEC2PROOF_BROWSER_HEADLESS: booleanFromString.default(true),
  SPEC2PROOF_BROWSER_PROVIDER: z.enum(["local", "agentcore"]).default("local"),
  SPEC2PROOF_AGENTCORE_BROWSER_ID: z.string().min(1).default("aws.browser.v1"),
  SPEC2PROOF_EVIDENCE_STORE: z.enum(["local", "s3"]).default("local"),
  SPEC2PROOF_EVIDENCE_BUCKET: z.string().min(3).optional(),
  SPEC2PROOF_EVIDENCE_PREFIX: z.string().default("spec2proof"),
  SPEC2PROOF_ARTIFACTS_DIR: z.string().min(1).default("artifacts"),
  SPEC2PROOF_MAX_AGENT_TURNS: z.coerce.number().int().min(1).max(100).default(40),
});

export const awsWebhookEnvSchema = sharedEnvSchema.extend({
  GITHUB_APP_SECRET_ARN: z.string().min(1),
  SPEC2PROOF_DELIVERY_TABLE: z.string().min(1),
  SPEC2PROOF_WEBHOOK_QUEUE_URL: z.string().url(),
});

export const awsWorkerEnvSchema = sharedEnvSchema
  .extend({
    GITHUB_APP_SECRET_ARN: z.string().min(1),
    GITHUB_API_URL: z
      .string()
      .url()
      .default("https://api.github.com")
      .transform(stripTrailingSlash),
    SPEC2PROOF_RUNS_TABLE: z.string().min(1),
    SPEC2PROOF_RUNS_PR_INDEX: z.string().min(1).default("pr-created-index"),
    SPEC2PROOF_AGENT_RUNTIME_ARN: z.string().min(20),
    SPEC2PROOF_AGENT_RUNTIME_QUALIFIER: z.string().min(1).default("DEFAULT"),
    SPEC2PROOF_AGENT_RUNTIME_TIMEOUT_SECONDS: z.coerce
      .number()
      .int()
      .min(30)
      .max(1_800)
      .default(900),
  })
  .and(githubLimitsSchema);

export const githubSetupEnvSchema = z.object({
  AWS_REGION: z.string().min(1).default("us-west-2"),
  GITHUB_APP_SECRET_ARN: z.string().min(1),
  SPEC2PROOF_SETUP_TOKEN: z.string().min(24),
  SPEC2PROOF_PUBLIC_BASE_URL: z.string().url().transform(stripTrailingSlash),
  GITHUB_MANIFEST_URL: z
    .string()
    .url()
    .default("https://github.com/settings/apps/new")
    .transform(stripTrailingSlash),
  GITHUB_API_URL: z
    .string()
    .url()
    .default("https://api.github.com")
    .transform(stripTrailingSlash),
});

export type WebhookEnvironment = z.infer<typeof webhookEnvSchema>;
export type AgentRuntimeEnvironment = z.infer<typeof agentRuntimeEnvSchema>;
export type AwsWebhookEnvironment = z.infer<typeof awsWebhookEnvSchema>;
export type AwsWorkerEnvironment = z.infer<typeof awsWorkerEnvSchema>;
export type GitHubSetupEnvironment = z.infer<typeof githubSetupEnvSchema>;

export function loadWebhookEnvironment(
  input: NodeJS.ProcessEnv = process.env,
): WebhookEnvironment {
  return webhookEnvSchema.parse(input);
}

export function loadRuntimeEnvironment(
  input: NodeJS.ProcessEnv = process.env,
): AgentRuntimeEnvironment {
  return agentRuntimeEnvSchema.parse(input);
}

export function loadAwsWebhookEnvironment(
  input: NodeJS.ProcessEnv = process.env,
): AwsWebhookEnvironment {
  return awsWebhookEnvSchema.parse(input);
}

export function loadAwsWorkerEnvironment(
  input: NodeJS.ProcessEnv = process.env,
): AwsWorkerEnvironment {
  return awsWorkerEnvSchema.parse(input);
}

export function loadGitHubSetupEnvironment(
  input: NodeJS.ProcessEnv = process.env,
): GitHubSetupEnvironment {
  return githubSetupEnvSchema.parse(input);
}

// Compatibility aliases retained for callers created by the initial scaffold.
export const loadWebhookEnv = loadWebhookEnvironment;
export const loadAgentRuntimeEnv = loadRuntimeEnvironment;
export type WebhookEnv = WebhookEnvironment;
export type AgentRuntimeEnv = AgentRuntimeEnvironment;

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/u, "");
}
