// Bundles each entry point with its dependencies into dist/, which is committed: the runner runs
// dist/main.js and dist/post.js as they are, without installing anything.
import { build } from "esbuild";

await build({
  entryPoints: ["src/main.ts", "src/post.ts"],
  outdir: "dist",
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  // Some dependencies are CommonJS and call require() for Node built-ins.
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  legalComments: "eof",
  logLevel: "info",
});
