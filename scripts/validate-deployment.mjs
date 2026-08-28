import { readFileSync } from "node:fs";
import { parseDocument } from "yaml";

const cloudFormationTags = ["!Ref", "!Sub", "!GetAtt"].map((tag) => ({
  tag,
  resolve: (value) => value,
}));

function readTemplate(file) {
  const document = parseDocument(readFileSync(file, "utf8"), {
    customTags: cloudFormationTags,
  });
  if (document.errors.length > 0) {
    throw new Error(`${file}: ${document.errors.map((error) => error.message).join("; ")}`);
  }
  const value = document.toJS();
  if (!value || typeof value !== "object" || !value.Resources) {
    throw new Error(`${file} does not define Resources`);
  }
  return value;
}

readTemplate("deploy/aws/foundation.yaml");
const application = readTemplate("deploy/aws/template.yaml");
const required = [
  "HttpApi",
  "GitHubAppCredentialsSecret",
  "RunsTable",
  "DeliveriesTable",
  "WebhookQueue",
  "ExecutionQueue",
  "WebhookFunction",
  "GitHubAppSetupFunction",
  "GitHubWorkerFunction",
  "RunExecutionWorkerFunction",
];
for (const logicalId of required) {
  if (!application.Resources[logicalId]) {
    throw new Error(`deploy/aws/template.yaml is missing ${logicalId}`);
  }
}

const commandEnvironment =
  application.Resources.GitHubWorkerFunction.Properties.Environment.Variables;
if (!commandEnvironment.SPEC2PROOF_EXECUTION_QUEUE_URL) {
  throw new Error("GitHubWorkerFunction does not schedule the execution queue");
}
if (commandEnvironment.SPEC2PROOF_AGENT_RUNTIME_ARN) {
  throw new Error("GitHubWorkerFunction must not block on AgentCore execution");
}

console.log("Deployment templates parsed and command/execution workers are separated.");
