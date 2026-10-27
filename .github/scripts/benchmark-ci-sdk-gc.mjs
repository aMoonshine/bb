import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, openSync, closeSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
const root = process.cwd();
const output = join(process.env.RUNNER_TEMP, "sdk-gc-results");
mkdirSync(output, { recursive: true });
const declarationDir = join(root, "packages/plugin-sdk/bundled-types");
const hashes = () => Object.fromEntries(readdirSync(declarationDir).filter((name) => name.endsWith(".d.ts")).sort().map((name) => [name, createHash("sha256").update(readFileSync(join(declarationDir, name))).digest("hex")]));
const expected = hashes();
writeFileSync(join(output, "expected-hashes.json"), JSON.stringify(expected, null, 2));
const sequence = process.env.BENCHMARK_ORDER === "default-first"
  ? ["default", "128", "heap4096", "heap4096", "128", "default"]
  : ["heap4096", "128", "default", "default", "128", "heap4096"];
const results = [];
for (const [index, setting] of sequence.entries()) {
  const metrics = join(output, `${index}-${setting}.json`);
  const fd = openSync(join(output, `${index}-${setting}.log`), "w");
  const args = [...(setting === "default" ? [] : setting === "heap4096" ? ["--max-semi-space-size=128", "--max-old-space-size=4096"] : ["--max-semi-space-size=128"]), resolve(".github/scripts/benchmark-sdk-gc-worker.mjs")];
  const started = performance.now();
  const result = spawnSync(process.execPath, args, {
    cwd: join(root, "packages/plugin-sdk"),
    env: { ...process.env, SDK_METRICS_PATH: metrics },
    stdio: ["ignore", fd, fd],
  });
  const seconds = (performance.now() - started) / 1000;
  closeSync(fd);
  const actual = hashes();
  const identical = JSON.stringify(expected) === JSON.stringify(actual);
  results.push({ setting, seconds, status: result.status, identical, hashes: actual, error: result.error?.message });
  writeFileSync(join(output, "results.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ setting, seconds, status: result.status, identical }));
  if (result.status !== 0 || !identical) throw new Error("Build failed or declarations changed");
}
