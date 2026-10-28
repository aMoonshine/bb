import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, openSync, closeSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
const root = process.cwd();
const output = join(process.env.RUNNER_TEMP, "public-sdk-heap");
mkdirSync(output, { recursive: true });
const hash = () => createHash("sha256").update(readFileSync("packages/bb-app/dist/index.d.ts")).digest("hex");
const expected = hash();
const order = process.env.BENCHMARK_ORDER === "default-first" ? ["default", "larger", "larger", "default"] : ["larger", "default", "default", "larger"];
const rows = [];
for (const [i, setting] of order.entries()) {
  const metrics = join(output, `${i}-${setting}.json`);
  const fd = openSync(join(output, `${i}-${setting}.log`), "w");
  const started = performance.now();
  const result = spawnSync(process.execPath, [...(setting === "larger" ? ["--max-semi-space-size=128", "--max-old-space-size=4096"] : []), resolve(".github/scripts/public-sdk-heap-worker.mjs")], { cwd: join(root, "packages/bb-app"), env: { ...process.env, PUBLIC_SDK_METRICS: metrics }, stdio: ["ignore", fd, fd] });
  closeSync(fd);
  const actual = hash();
  rows.push({ setting, seconds: (performance.now()-started)/1000, status: result.status, expected, actual, identical: actual === expected });
  writeFileSync(join(output, "results.json"), JSON.stringify(rows, null, 2));
  console.log(JSON.stringify(rows.at(-1)));
  if (result.status !== 0 || actual !== expected) throw new Error("Build failed or declaration bytes changed");
}
