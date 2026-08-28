import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const required = [
  "AWS_ACCOUNT_ID",
  "AWS_REGION",
  "SPEC2PROOF_EVIDENCE_BUCKET",
  "SPEC2PROOF_ALLOWED_HOSTS",
  "SPEC2PROOF_AGENTCORE_EXECUTION_ROLE_ARN",
];
const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`Missing environment variables: ${missing.join(", ")}`);
  process.exit(1);
}

const configPath = "agentcore/agentcore.json";
const config = JSON.parse(readFileSync(configPath, "utf8"));
const runtime = config.runtimes?.find((item) => item.name === "Spec2ProofRuntime");
if (!runtime) {
  throw new Error("Spec2ProofRuntime is missing from agentcore/agentcore.json");
}
runtime.executionRoleArn = process.env.SPEC2PROOF_AGENTCORE_EXECUTION_ROLE_ARN;
setEnv(runtime, "AWS_REGION", process.env.AWS_REGION);
setEnv(runtime, "SPEC2PROOF_EVIDENCE_BUCKET", process.env.SPEC2PROOF_EVIDENCE_BUCKET);
setEnv(runtime, "SPEC2PROOF_ALLOWED_HOSTS", process.env.SPEC2PROOF_ALLOWED_HOSTS);
if (process.env.SPEC2PROOF_MODEL_ID) {
  setEnv(runtime, "SPEC2PROOF_MODEL_ID", process.env.SPEC2PROOF_MODEL_ID);
}
writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
writeFileSync(
  "agentcore/aws-targets.json",
  `${JSON.stringify(
    [
      {
        name: "default",
        description: "Spec2Proof deployment target",
        account: process.env.AWS_ACCOUNT_ID,
        region: process.env.AWS_REGION,
      },
    ],
    null,
    2,
  )}\n`,
);

for (const [command, args] of [
  ["npm", ["run", "check"]],
  ["agentcore", ["validate"]],
  ["agentcore", ["deploy", "--dry-run"]],
]) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log("AgentCore configuration is valid. Run `agentcore deploy -y` to provision the runtime.");

function setEnv(runtime, name, value) {
  const entry = runtime.envVars.find((item) => item.name === name);
  if (entry) {
    entry.value = value;
  } else {
    runtime.envVars.push({ name, value });
  }
}
