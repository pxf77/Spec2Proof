import { createHash } from "node:crypto";
import { z } from "zod";

export const githubWebhookMessageSchema = z.object({
  eventName: z.string().min(1),
  deliveryId: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
});

export type GitHubWebhookMessage = z.infer<typeof githubWebhookMessageSchema>;

export function webhookDispatchGroup(message: GitHubWebhookMessage): string {
  const repository = readString(message.payload.repository, "full_name") ?? "unknown";
  const number =
    readNumber(message.payload.issue, "number") ??
    readNumber(message.payload.pull_request, "number") ??
    readNumber(message.payload, "number");
  const raw = number === undefined ? repository : `${repository}#${number}`;
  return createHash("sha256").update(raw).digest("hex").slice(0, 64);
}

function readString(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const item = (value as Record<string, unknown>)[key];
  return typeof item === "string" ? item : undefined;
}

function readNumber(value: unknown, key: string): number | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const item = (value as Record<string, unknown>)[key];
  return typeof item === "number" && Number.isInteger(item) ? item : undefined;
}
