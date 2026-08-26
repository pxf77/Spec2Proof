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
  "WebhookFunction",
  "GitHubAppSetupFunction",
  "GitHubWorkerFunction",
];
for (const logicalId of required) {
  if (!application.Resources[logicalId]) {
    throw new Error(`deploy/aws/template.yaml is missing ${logicalId}`);
  }
}

console.log("Deployment templates parsed and required resources are present.");
