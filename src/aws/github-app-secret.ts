import {
  GetSecretValueCommand,
  PutSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { z } from "zod";
import type { WebhookSecretProvider } from "../webhook/ingress.js";

const githubAppCredentialsSchema = z.object({
  appId: z.number().int().positive(),
  privateKey: z.string().min(32),
  webhookSecret: z.string().min(16),
  slug: z.string().min(1).optional(),
  htmlUrl: z.string().url().optional(),
});

export type GitHubAppCredentials = z.infer<typeof githubAppCredentialsSchema>;

export class SecretsManagerGitHubAppCredentials implements WebhookSecretProvider {
  private cached?: { value: GitHubAppCredentials; expiresAt: number };

  public constructor(
    private readonly secretId: string,
    private readonly client = new SecretsManagerClient({}),
    private readonly cacheMs = 5 * 60 * 1_000,
    private readonly now: () => number = Date.now,
  ) {}

  public async getWebhookSecret(): Promise<string> {
    return (await this.getCredentials()).webhookSecret;
  }

  public async getCredentials(): Promise<GitHubAppCredentials> {
    if (this.cached && this.cached.expiresAt > this.now()) {
      return structuredClone(this.cached.value);
    }

    const response = await this.client.send(
      new GetSecretValueCommand({ SecretId: this.secretId }),
    );
    if (!response.SecretString) {
      throw new Error("GitHub App credentials secret is not configured");
    }

    const parsed = githubAppCredentialsSchema.parse(JSON.parse(response.SecretString));
    this.cached = { value: parsed, expiresAt: this.now() + this.cacheMs };
    return structuredClone(parsed);
  }

  public async save(credentials: GitHubAppCredentials): Promise<void> {
    const parsed = githubAppCredentialsSchema.parse(credentials);
    await this.client.send(
      new PutSecretValueCommand({
        SecretId: this.secretId,
        SecretString: JSON.stringify(parsed),
      }),
    );
    this.cached = { value: parsed, expiresAt: this.now() + this.cacheMs };
  }
}
