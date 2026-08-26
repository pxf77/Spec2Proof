import assert from "node:assert/strict";
import test from "node:test";
import { parseSpec2ProofPullRequestBody } from "../src/github/pull-request.js";

const body = `
## Summary

Adds a deterministic login flow.

\`\`\`yaml
spec2proof:
  target:
    environment: staging
    base_url: https://staging.example.com
  criteria:
    - id: AC-001
      description: Valid users reach the dashboard
      preconditions:
        - A synthetic active user exists
      automation_class: AUTO
      expected:
        - type: url
          matches: /dashboard
          mode: prefix
    - id: AC-002
      description: Dashboard heading is visible
      expected:
        - type: element
          selector_hint: Dashboard heading
          visible: true
    - id: AC-003
      description: Reviewer confirms the brand treatment
      expected:
        - type: human
          reason: Subjective visual review
\`\`\`
`;

test("parses the structured Spec2Proof block from a PR body", () => {
  const parsed = parseSpec2ProofPullRequestBody(body, 17);

  assert.equal(parsed.targetEnvironment, "staging");
  assert.equal(parsed.targetBaseUrl, "https://staging.example.com");
  assert.equal(parsed.criteria.length, 3);
  assert.deepEqual(parsed.criteria[0], {
    id: "AC-001",
    sourceRef: "PR#17:spec2proof/AC-001",
    description: "Valid users reach the dashboard",
    preconditions: ["A synthetic active user exists"],
    expectedOutcomes: [{ type: "url", matches: "/dashboard", mode: "prefix" }],
    automationClass: "AUTO",
  });
  assert.deepEqual(parsed.criteria[1]?.expectedOutcomes, [
    { type: "element", selectorHint: "Dashboard heading", state: "visible" },
  ]);
  assert.equal(parsed.criteria[2]?.automationClass, "HUMAN");
});

test("fails closed when the structured Spec2Proof block is missing", () => {
  assert.throws(
    () => parseSpec2ProofPullRequestBody("- [ ] AC-001 feature works", 1),
    /fenced YAML block/u,
  );
});

test("rejects criteria that mix deterministic and human outcomes", () => {
  const mixed = `
\`\`\`yaml
spec2proof:
  target:
    environment: staging
    base_url: https://staging.example.com
  criteria:
    - id: AC-001
      description: Mixed verification
      expected:
        - type: text
          value: Done
        - type: human
          reason: Visual review
\`\`\`
`;

  assert.throws(
    () => parseSpec2ProofPullRequestBody(mixed, 1),
    /mixes human and deterministic outcomes/u,
  );
});
