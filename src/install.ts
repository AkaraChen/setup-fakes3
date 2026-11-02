import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import * as core from "@actions/core";
import { HttpClient } from "@actions/http-client";
import * as tc from "@actions/tool-cache";

const REPO = "https://github.com/AkaraChen/fakes3";

// Release assets are static musl binaries, so any Linux distribution works, but only Linux:
// large objects live in memfds.
const TRIPLES: Partial<Record<NodeJS.Architecture, string>> = {
  x64: "x86_64-unknown-linux-musl",
  arm64: "aarch64-unknown-linux-musl",
};

export interface Installed {
  version: string;
  binary: string;
}

export async function install(spec: string): Promise<Installed> {
  const triple = TRIPLES[process.arch];
  if (process.platform !== "linux" || !triple) {
    throw new Error(
      `fakes3 runs on Linux x64 and arm64 only, not ${process.platform}/${process.arch} ` +
        "(large objects are stored in Linux memfds). Run the job on a Linux runner.",
    );
  }

  const version = await resolveVersion(spec);
  let dir = tc.find("fakes3", version, process.arch);
  if (dir) {
    core.info(`fakes3 ${version} found in the tool cache`);
  } else {
    dir = await download(version, triple);
  }
  const binary = path.join(dir, "fakes3");

  const reported = execFileSync(binary, ["--version"], { encoding: "utf8" }).trim();
  if (reported !== `fakes3 ${version}`) {
    throw new Error(`expected fakes3 ${version}, but ${binary} --version printed ${JSON.stringify(reported)}`);
  }
  core.info(`Installed ${reported} at ${binary}`);
  return { version, binary };
}

/** `latest`, `0.1.0` or `v0.1.0` -> `0.1.0`. */
async function resolveVersion(spec: string): Promise<string> {
  spec = spec.trim();
  if (spec === "" || spec === "latest") {
    // github.com redirects /releases/latest to /releases/tag/<tag>. Reading the redirect needs no
    // token and is not subject to the REST API's rate limit.
    const http = new HttpClient("setup-fakes3", [], { allowRedirects: false });
    const res = await http.head(`${REPO}/releases/latest`);
    const location = res.message.headers.location ?? "";
    const tag = /\/releases\/tag\/(v[^/?#]+)$/.exec(location)?.[1];
    if (!tag) {
      throw new Error(`could not resolve the latest fakes3 release (HTTP ${res.message.statusCode}, location ${JSON.stringify(location)})`);
    }
    core.info(`Latest fakes3 release is ${tag}`);
    return tag.slice(1);
  }
  const m = /^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(spec);
  if (!m) {
    throw new Error(`version must be "latest" or an exact version such as 0.1.0, not ${JSON.stringify(spec)}`);
  }
  return m[1];
}

async function download(version: string, triple: string): Promise<string> {
  const name = `fakes3-${triple}`;
  const url = `${REPO}/releases/download/v${version}/${name}.tar.gz`;
  core.info(`Downloading ${url}`);

  let archive: string;
  let checksum: string;
  try {
    archive = await tc.downloadTool(url);
    checksum = await readFile(await tc.downloadTool(`${url}.sha256`), "utf8");
  } catch (e) {
    if (e instanceof tc.HTTPError && e.httpStatusCode === 404) {
      throw new Error(`fakes3 ${version} has no ${triple} release asset; see ${REPO}/releases`);
    }
    throw e;
  }

  // `<sha256>  <file name>`, as written by sha256sum.
  const expected = checksum.trim().split(/\s+/)[0]?.toLowerCase();
  const actual = createHash("sha256").update(await readFile(archive)).digest("hex");
  if (actual !== expected) {
    throw new Error(`checksum mismatch for ${name}.tar.gz: expected ${expected}, got ${actual}`);
  }

  const extracted = await tc.extractTar(archive);
  return tc.cacheDir(path.join(extracted, name), "fakes3", version, process.arch);
}
