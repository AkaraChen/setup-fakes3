import { spawn } from "node:child_process";
import { closeSync, openSync, readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

export interface Running {
  pid: number;
  endpoint: string;
  port: number;
}

/**
 * Starts fakes3 in the background with stdout and stderr going to `logFile`, and waits for the
 * address it prints once it is listening. The process outlives this step; the runner kills it at
 * the end of the job if the post step has not.
 */
export async function start(binary: string, args: string[], logFile: string, timeoutMs: number): Promise<Running> {
  const fd = openSync(logFile, "w");
  const child = spawn(binary, args, { detached: true, stdio: ["ignore", fd, fd] });
  closeSync(fd);
  let exited: string | undefined;
  child.on("error", (e) => (exited = `could not be started (${e.message})`));
  child.on("exit", (code, signal) => (exited = signal ? `was killed by ${signal}` : `exited with code ${code}`));
  child.unref();

  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const log = readFileSync(logFile, "utf8");
    const line = /^http:\/\/\S+$/m.exec(log)?.[0];
    if (line && child.pid) {
      return { pid: child.pid, ...clientEndpoint(line) };
    }
    if (exited) {
      throw new Error(`fakes3 ${exited} before it was ready. Its output:\n${log}`);
    }
    if (Date.now() > deadline) {
      child.kill("SIGKILL");
      throw new Error(`fakes3 did not print its address within ${timeoutMs / 1000}s. Its output:\n${log}`);
    }
    await sleep(10);
  }
}

/** `http://0.0.0.0:9000` is where the server listens; clients connect to `http://127.0.0.1:9000`. */
function clientEndpoint(printed: string): { endpoint: string; port: number } {
  const url = new URL(printed);
  const host = url.hostname === "0.0.0.0" ? "127.0.0.1" : url.hostname === "[::]" ? "[::1]" : url.hostname;
  const port = Number(url.port || 80);
  return { endpoint: `http://${host}:${port}`, port };
}

/** Stops the server. Returns false if it had already exited. */
export async function stop(pid: number, timeoutMs = 5000): Promise<boolean> {
  if (!alive(pid)) {
    return false;
  }
  process.kill(pid, "SIGTERM");
  const deadline = Date.now() + timeoutMs;
  while (alive(pid)) {
    if (Date.now() > deadline) {
      process.kill(pid, "SIGKILL");
      break;
    }
    await sleep(20);
  }
  return true;
}

// Reads /proc rather than sending signal 0: in container jobs the server is reparented to the
// container's init (`tail -f /dev/null`), which never reaps it, so a dead server lingers as a zombie.
function alive(pid: number): boolean {
  let stat: string;
  try {
    stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  } catch {
    return false;
  }
  const state = stat.slice(stat.lastIndexOf(")") + 2, stat.lastIndexOf(")") + 3);
  return state !== "Z" && state !== "X";
}
