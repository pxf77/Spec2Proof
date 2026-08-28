import assert from "node:assert/strict";
import test from "node:test";
import { webhookDispatchGroup } from "../src/webhook/message.js";

test("uses a stable per-pull-request FIFO group", () => {
  const first = webhookDispatchGroup({
    eventName: "issue_comment",
    deliveryId: "one",
    payload: {
      repository: { full_name: "pxf77/Spec2Proof" },
      issue: { number: 42 },
    },
  });
  const second = webhookDispatchGroup({
    eventName: "pull_request",
    deliveryId: "two",
    payload: {
      repository: { full_name: "pxf77/Spec2Proof" },
      pull_request: { number: 42 },
    },
  });
  const other = webhookDispatchGroup({
    eventName: "pull_request",
    deliveryId: "three",
    payload: {
      repository: { full_name: "pxf77/Spec2Proof" },
      pull_request: { number: 43 },
    },
  });

  assert.equal(first, second);
  assert.notEqual(first, other);
  assert.match(first, /^[a-f0-9]{64}$/u);
});
