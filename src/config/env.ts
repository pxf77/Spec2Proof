import { z } from 'zod'

const booleanFromString = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true')

const sharedEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  AWS_REGION: z.string().min(1).default('us-west-2'),
  SPEC2PROOF_MODEL_ID: z
    .string()
    .min(1)
    .default('global.anthropic.claude-sonnet-4-6'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
})

export const webhookEnvSchema = sharedEnvSchema.extend({
  WEBHOOK_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  GITHUB_WEBHOOK_SECRET: z.string().min(16),
})

export const agentRuntimeEnvSchema = sharedEnvSchema.extend({
  AGENT_RUNTIME_PORT: z.coerce.number().int().min(1).max(65_535).default(8080),
  SPEC2PROOF_ALLOWED_HOSTS: z
    .string()
    .min(1)
    .transform((value) =>
      value
        .split(',')
        .map((host) => host.trim().toLowerCase())
        .filter(Boolean),
    ),
  SPEC2PROOF_ALLOW_HTTP: booleanFromString.default(false),
  SPEC2PROOF_ALLOW_PRIVATE_HOSTS: booleanFromString.default(false),
  SPEC2PROOF_BROWSER_HEADLESS: booleanFromString.default(true),
  SPEC2PROOF_ARTIFACTS_DIR: z.string().min(1).default('artifacts'),
  SPEC2PROOF_MAX_AGENT_TURNS: z.coerce.number().int().min(1).max(100).default(40),
})

export type WebhookEnv = z.infer<typeof webhookEnvSchema>
export type AgentRuntimeEnv = z.infer<typeof agentRuntimeEnvSchema>

export function loadWebhookEnv(
  input: NodeJS.ProcessEnv = process.env,
): WebhookEnv {
  return webhookEnvSchema.parse(input)
}

export function loadAgentRuntimeEnv(
  input: NodeJS.ProcessEnv = process.env,
): AgentRuntimeEnv {
  return agentRuntimeEnvSchema.parse(input)
}
