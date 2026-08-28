import assert from "node:assert/strict";
import test from "node:test";
import { SqsRunExecutionScheduler } from "../src/aws/sqs-run-execution-scheduler.js";

test("schedules one FIFO execution message for a run", async () => {
  const commands: unknown[] = [];
  const client = {
    send: async (command: unknown) => {
      commands.push(command);
      return {};
    },
  };
  const scheduler = new SqsRunExecutionScheduler(
    "https://sqs.us-west-2.amazonaws.com/123456789012/execution.fifo",
    client as never,
  );

  await scheduler.schedule("run-001");

  assert.equal(commands.length, 1);
  const input = (commands[0] as { input: Record<string, unknown> }).input;
  assert.equal(input.MessageBody, JSON.stringify({ runId: "run-001" }));
  assert.match(String(input.MessageGroupId), /^[a-f0-9]{64}$/u);
  assert.equal(input.MessageGroupId, input.MessageDeduplicationId);
});
