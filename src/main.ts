import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import * as core from "@actions/core";

import { install } from "./install.js";
import { start } from "./server.js";

async function main(): Promise<void> {
  const { version, binary } = await install(core.getInput("version"));
  core.addPath(path.dirname(binary));
  core.setOutput("version", version);
  core.setOutput("path", binary);
  if (!core.getBooleanInput("start")) {
    return;
  }

  const accessKey = core.getInput("access-key", { required: true });
  const secretKey = core.getInput("secret-key", { required: true });
  const args = [
    "--host",
    core.getInput("host", { required: true }),
    "--port",
    String(port(core.getInput("port", { required: true }))),
    "--access-key",
    accessKey,
    "--secret-key",
    secretKey,
  ];
  if (core.getBooleanInput("auth")) {
    args.push("--auth");
  }
  for (const user of core.getMultilineInput("users")) {
    args.push("--user", user);
  }
  for (const [input, flag] of [
    ["bucket-defaults", "--bucket-defaults"],
    ["memory-limit", "--memory-limit"],
  ]) {
    const value = core.getInput(input);
    if (value) {
      args.push(flag, value);
    }
  }
  args.push(...core.getInput("args").split(/\s+/).filter(Boolean));

  const timeout = Number(core.getInput("wait-timeout", { required: true }));
  if (!(timeout > 0)) {
    throw new Error(`wait-timeout must be a positive number of seconds, not ${JSON.stringify(core.getInput("wait-timeout"))}`);
  }

  const logFile = path.join(mkdtempSync(path.join(process.env.RUNNER_TEMP || os.tmpdir(), "fakes3-")), "fakes3.log");
  core.info(`Starting fakes3 ${args.join(" ")}`);
  const server = await start(binary, args, logFile, timeout * 1000);
  core.saveState("pid", server.pid);
  core.saveState("log-file", logFile);
  core.info(`fakes3 is listening on ${server.endpoint} (pid ${server.pid}, log ${logFile})`);

  core.setOutput("endpoint", server.endpoint);
  core.setOutput("port", server.port);
  core.setOutput("access-key", accessKey);
  core.setOutput("secret-key", secretKey);
  core.setOutput("pid", server.pid);
  core.setOutput("log-file", logFile);
  // `fakes3 ctl` reads FAKES3_ENDPOINT.
  core.exportVariable("FAKES3_ENDPOINT", server.endpoint);
  if (core.getBooleanInput("aws-env")) {
    core.exportVariable("AWS_ENDPOINT_URL_S3", server.endpoint);
    core.exportVariable("AWS_ACCESS_KEY_ID", accessKey);
    core.exportVariable("AWS_SECRET_ACCESS_KEY", secretKey);
    for (const name of ["AWS_REGION", "AWS_DEFAULT_REGION"]) {
      if (!process.env[name]) {
        core.exportVariable(name, "us-east-1");
      }
    }
  }
}

function port(input: string): number {
  const n = Number(input);
  if (!Number.isInteger(n) || n < 0 || n > 65535) {
    throw new Error(`port must be 0 to 65535, not ${JSON.stringify(input)}`);
  }
  return n;
}

main().catch((e: unknown) => core.setFailed(e instanceof Error ? e.message : String(e)));
