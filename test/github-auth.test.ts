import assert from "node:assert/strict";
import {
  createVerify,
  generateKeyPairSync,
} from "node:crypto";
import test from "node:test";
import { GitHubAppTokenProvider } from "../src/github/client.js";

test("creates a signed GitHub App JWT and caches installation tokens", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const now = Date.parse("2026-08-26T12:00:00.000Z");
  let requests = 0;

  const fetchStub = (async (input: string | URL | Request, init?: RequestInit) => {
    requests += 1;
    assert.equal(String(input), "https://api.github.test/app/installations/42/access_tokens");
    const authorization = new Headers(init?.headers).get("authorization");
    assert.ok(authorization);
    assert.ok(authorization.startsWith("Bearer "));
    const jwt = authorization.slice("Bearer ".length);
    const parts = jwt.split(".");
    assert.equal(parts.length, 3);
    const unsigned = `${parts[0]}.${parts[1]}`;
    const verifier = createVerify("RSA-SHA256");
    verifier.update(unsigned);
    verifier.end();
    assert.equal(
      verifier.verify(publicPem, Buffer.from(parts[2] ?? "", "base64url")),
      true,
    );
    const payload = JSON.parse(
      Buffer.from(parts[1] ?? "", "base64url").toString("utf8"),
    ) as { iss: number; iat: number; exp: number };
    assert.equal(payload.iss, 1234);
    assert.ok(payload.exp - payload.iat <= 540);

    return new Response(
      JSON.stringify({
        token: "installation-token",
        expires_at: "2026-08-26T13:00:00.000Z",
      }),
      { status: 201, headers: { "content-type": "application/json" } },
    );
  }) as typeof globalThis.fetch;

  const provider = new GitHubAppTokenProvider({
    appId: 1234,
    privateKey: privatePem,
    apiBaseUrl: "https://api.github.test",
    fetch: fetchStub,
    now: () => now,
  });

  assert.equal(await provider.getInstallationToken(42), "installation-token");
  assert.equal(await provider.getInstallationToken(42), "installation-token");
  assert.equal(requests, 1);
});
