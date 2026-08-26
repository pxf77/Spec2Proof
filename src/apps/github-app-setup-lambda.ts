import { createHmac, timingSafeEqual } from "node:crypto";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { z } from "zod";
import { SecretsManagerGitHubAppCredentials } from "../aws/github-app-secret.js";
import { loadGitHubSetupEnvironment } from "../config/env.js";

const manifestConversionSchema = z.object({
  id: z.number().int().positive(),
  pem: z.string().min(32),
  webhook_secret: z.string().min(16),
  slug: z.string().min(1),
  html_url: z.string().url(),
});

const environment = loadGitHubSetupEnvironment();
const secretStore = new SecretsManagerGitHubAppCredentials(
  environment.GITHUB_APP_SECRET_ARN,
);

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    if (event.rawPath === "/setup/github-app") {
      return renderManifestPage(event.queryStringParameters?.token);
    }
    if (event.rawPath === "/setup/github-app/callback") {
      return await completeManifest(
        event.queryStringParameters?.code,
        event.queryStringParameters?.state,
      );
    }
    return html(404, "<h1>Not found</h1>");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown setup error";
    return html(
      500,
      `<h1>GitHub App setup failed</h1><p>${escapeHtml(message)}</p>`,
    );
  }
};

function renderManifestPage(token: string | undefined) {
  if (!safeEqual(token, environment.SPEC2PROOF_SETUP_TOKEN)) {
    return html(403, "<h1>Forbidden</h1><p>The setup token is invalid.</p>");
  }

  const state = manifestState();
  const suffix = state.slice(0, 8);
  const callbackUrl = `${environment.SPEC2PROOF_PUBLIC_BASE_URL}/setup/github-app/callback`;
  const webhookUrl = `${environment.SPEC2PROOF_PUBLIC_BASE_URL}/webhooks/github`;
  const manifest = {
    name: `Spec2Proof-${suffix}`,
    url: "https://github.com/pxf77/Spec2Proof",
    hook_attributes: { url: webhookUrl, active: true },
    redirect_url: callbackUrl,
    public: false,
    default_permissions: {
      checks: "write",
      contents: "read",
      issues: "write",
      pull_requests: "read",
    },
    default_events: ["issue_comment", "pull_request"],
  };
  const action = `${environment.GITHUB_MANIFEST_URL}?state=${encodeURIComponent(state)}`;

  return html(
    200,
    `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Configure Spec2Proof GitHub App</title></head>
<body>
  <main>
    <h1>Configure Spec2Proof GitHub App</h1>
    <p>This creates a private GitHub App with the minimum permissions required by Spec2Proof.</p>
    <form action="${escapeHtml(action)}" method="post">
      <input type="hidden" name="manifest" value="${escapeHtml(JSON.stringify(manifest))}">
      <button type="submit">Create GitHub App</button>
    </form>
  </main>
</body>
</html>`,
  );
}

async function completeManifest(code: string | undefined, state: string | undefined) {
  if (!code || !safeEqual(state, manifestState())) {
    return html(400, "<h1>Invalid callback</h1><p>The code or state is missing.</p>");
  }

  const response = await fetch(
    `${environment.GITHUB_API_URL}/app-manifests/${encodeURIComponent(code)}/conversions`,
    {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
      },
    },
  );
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`GitHub manifest conversion returned HTTP ${response.status}`);
  }
  const converted = manifestConversionSchema.parse(JSON.parse(body));
  await secretStore.save({
    appId: converted.id,
    privateKey: converted.pem,
    webhookSecret: converted.webhook_secret,
    slug: converted.slug,
    htmlUrl: converted.html_url,
  });

  const installUrl = `https://github.com/apps/${encodeURIComponent(converted.slug)}/installations/new`;
  return html(
    200,
    `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Spec2Proof GitHub App created</title></head>
<body>
  <main>
    <h1>GitHub App created</h1>
    <p>The App ID, private key, and webhook secret were stored in AWS Secrets Manager.</p>
    <p><a href="${escapeHtml(installUrl)}">Install Spec2Proof on a repository</a></p>
  </main>
</body>
</html>`,
  );
}

function manifestState(): string {
  return createHmac("sha256", environment.SPEC2PROOF_SETUP_TOKEN)
    .update("spec2proof-github-app-manifest-v1")
    .digest("hex");
}

function safeEqual(left: string | undefined, right: string): boolean {
  if (!left) {
    return false;
  }
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function html(statusCode: number, body: string) {
  return {
    statusCode,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action https://github.com; base-uri 'none'",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
    body,
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
