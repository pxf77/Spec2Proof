import assert from "node:assert/strict";
import test from "node:test";
import { readAgentCoreRuntimeArn } from "../src/deployment/agentcore-state.js";

test("reads a runtime ARN from AgentCore deployed state", () => {
  const arn = readAgentCoreRuntimeArn({
    targets: {
      default: {
        resources: {
          runtimes: {
            Spec2ProofRuntime: {
              runtimeId: "runtime-1",
              runtimeArn:
                "arn:aws:bedrock-agentcore:us-west-2:123456789012:runtime/runtime-1",
              roleArn: "arn:aws:iam::123456789012:role/runtime",
            },
          },
        },
      },
    },
  });

  assert.equal(
    arn,
    "arn:aws:bedrock-agentcore:us-west-2:123456789012:runtime/runtime-1",
  );
});

test("fails closed when the selected runtime is missing", () => {
  assert.throws(
    () => readAgentCoreRuntimeArn({ targets: { default: { resources: {} } } }),
    /runtimes is missing or invalid/u,
  );
});
