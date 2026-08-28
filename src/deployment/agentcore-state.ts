export function readAgentCoreRuntimeArn(
  state: unknown,
  targetName = "default",
  runtimeName = "Spec2ProofRuntime",
): string {
  const root = asRecord(state, "AgentCore deployed state");
  const targets = asRecord(root.targets, "AgentCore deployed state targets");
  const target = asRecord(
    targets[targetName],
    `AgentCore deployment target ${targetName}`,
  );
  const resources = asRecord(
    target.resources,
    `AgentCore deployment target ${targetName} resources`,
  );
  const runtimes = asRecord(
    resources.runtimes,
    `AgentCore deployment target ${targetName} runtimes`,
  );
  const runtime = asRecord(
    runtimes[runtimeName],
    `AgentCore runtime ${runtimeName}`,
  );
  const arn = runtime.runtimeArn;
  if (typeof arn !== "string" || !arn.startsWith("arn:")) {
    throw new Error(
      `AgentCore runtime ${runtimeName} does not contain a valid runtimeArn`,
    );
  }
  return arn;
}

function asRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is missing or invalid`);
  }
  return value as Record<string, unknown>;
}
