import { z } from "zod";

const booleanFromString = z
  .enum(["true", "false"])
  .transform((value: string) => value === "true");

export const webhookEnvironmentSchema = z.object({
  WEBHOOK_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  GITHUB_WEBHOOK_SECRET: z.string().min(16),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export const runtimeEnvironmentSchema = z.object({
  AGENT_RUNTIME_PORT: z.coerce.number().int().min(1).max(65_535).default(8080),
  AWS_REGION: z.string().min(1).default("us-west-2"),
  SPEC2PROOF_MODEL_ID: z
    .string()
    .min(1)
    .default("global.anthropic.claude-sonnet-4-6"),
  SPEC2PROOF_ALLOWED_HOSTS: z
    .string()
    .min(1)
    .transform((value: string) =>
      value
        .split(",")
        .map((host: string) => host.trim())
        .filter(Boolean),
    ),
  SPEC2PROOF_ALLOW_HTTP: booleanFromString.default("false"),
  SPEC2PROOF_ALLOW_PRIVATE_HOSTS: booleanFromString.default("false"),
  SPEC2PROOF_BROWSER_HEADLESS: booleanFromString.default("true"),
  SPEC2PROOF_ARTIFACTS_DIR: z.string().min(1).default("artifacts"),
  SPEC2PROOF_MAX_AGENT_TURNS: z.coerce.number().int().min(1).max(200).default(40),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type WebhookEnvironment = z.infer<typeof webhookEnvironmentSchema>;
export type RuntimeEnvironment = z.infer<typeof runtimeEnvironmentSchema>;

export function loadWebhookEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): WebhookEnvironment {
  return webhookEnvironmentSchema.parse(environment);
}

export function loadRuntimeEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): RuntimeEnvironment {
  return runtimeEnvironmentSchema.parse(environment);
}
