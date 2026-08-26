import { createHmac, timingSafeEqual } from "node:crypto";

export type Spec2ProofCommand =
  | { name: "run" }
  | { name: "approve" }
  | { name: "reject"; reason: string }
  | { name: "cancel" }
  | { name: "rerun-failed" }
  | { name: "status" };

export function verifyGitHubWebhookSignature(
  payload: Uint8Array,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader?.startsWith("sha256=")) {
    return false;
  }

  const receivedHex = signatureHeader.slice("sha256=".length);
  if (!/^[a-f0-9]{64}$/u.test(receivedHex)) {
    return false;
  }

  const expected = createHmac("sha256", secret).update(payload).digest();
  const received = Buffer.from(receivedHex, "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export function parseSpec2ProofCommand(body: string): Spec2ProofCommand | undefined {
  const line = body
    .split(/\r?\n/u)
    .map((value) => value.trim())
    .find((value) => value.startsWith("/spec2proof"));

  if (!line) {
    return undefined;
  }

  const match = /^\/spec2proof\s+(run|approve|reject|cancel|rerun-failed|status)(?:\s+(.+))?$/u.exec(
    line,
  );
  if (!match) {
    return undefined;
  }

  const name = match[1];
  const argument = match[2]?.trim();
  switch (name) {
    case "run":
    case "approve":
    case "cancel":
    case "rerun-failed":
    case "status":
      return { name };
    case "reject":
      return argument ? { name: "reject", reason: argument } : undefined;
    default:
      return undefined;
  }
}
