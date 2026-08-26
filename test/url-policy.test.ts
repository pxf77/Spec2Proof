import assert from "node:assert/strict";
import test from "node:test";
import { UrlPolicy } from "../src/security/url-policy.js";

test("allows an exact HTTPS host", () => {
  const policy = new UrlPolicy({ allowedHosts: ["staging.example.com"] });
  assert.equal(policy.assertAllowed("https://staging.example.com/login").hostname, "staging.example.com");
});

test("rejects an unlisted host", () => {
  const policy = new UrlPolicy({ allowedHosts: ["staging.example.com"] });
  assert.throws(() => policy.assertAllowed("https://evil.example.com"), /not allowed/u);
});

test("rejects private hosts unless explicitly enabled", () => {
  const policy = new UrlPolicy({
    allowedHosts: ["127.0.0.1"],
    allowHttp: true,
  });
  assert.throws(() => policy.assertAllowed("http://127.0.0.1:3000"), /Private or local/u);
});

test("rejects IPv6 loopback and unique-local hosts", () => {
  const loopbackPolicy = new UrlPolicy({
    allowedHosts: ["::1"],
    allowHttp: true,
  });
  assert.throws(() => loopbackPolicy.assertAllowed("http://[::1]/"), /Private or local/u);

  const uniqueLocalPolicy = new UrlPolicy({
    allowedHosts: ["fd00::1"],
    allowHttp: true,
  });
  assert.throws(
    () => uniqueLocalPolicy.assertAllowed("http://[fd00::1]/"),
    /Private or local/u,
  );
});

test("rejects malformed host allowlist rules", () => {
  assert.throws(
    () => new UrlPolicy({ allowedHosts: ["https://staging.example.com"] }),
    /Invalid host allowlist/u,
  );
});

