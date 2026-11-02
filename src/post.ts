import { readFileSync } from "node:fs";

import * as core from "@actions/core";

import { stop } from "./server.js";

async function post(): Promise<void> {
  const pid = Number(core.getState("pid"));
  if (!pid) {
    return; // `start: false`, or the server never came up
  }
  const logFile = core.getState("log-file");
  const wasRunning = await stop(pid);

  let log: string;
  try {
    log = readFileSync(logFile, "utf8").trimEnd() || "(empty)";
  } catch (e) {
    log = `(could not read ${logFile}: ${e instanceof Error ? e.message : e})`;
  }
  if (wasRunning) {
    core.startGroup(`fakes3 log (${logFile})`);
    core.info(log);
    core.endGroup();
  } else {
    core.warning(`fakes3 (pid ${pid}) exited before the end of the job`);
    core.info(log);
  }
}

// A failure here must not fail a job whose tests passed.
post().catch((e: unknown) => core.warning(`stopping fakes3 failed: ${e instanceof Error ? e.message : e}`));
