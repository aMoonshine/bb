import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, openSync, closeSync, rmSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

const output = join(process.env.RUNNER_TEMP, "keyboard-results");
mkdirSync(output, { recursive: true });
const file = "apps/app/src/components/settings/KeyboardSettingsSection.test.tsx";
const candidate = readFileSync(file);
const fetched = spawnSync("git", ["fetch", "--depth=1", "origin", "880d072e5b0403dfea4b8c392a5840d3ce6c328f"], { stdio: "inherit" });
if (fetched.status !== 0) throw new Error("Baseline fetch failed");
const baseline = spawnSync("git", ["show", `FETCH_HEAD:${file}`], { maxBuffer: 1024 * 1024 });
if (baseline.status !== 0) throw new Error("Baseline read failed");
const sequence = process.env.BENCHMARK_ORDER === "baseline-first"
  ? ["baseline", "candidate", "candidate", "baseline"]
  : ["candidate", "baseline", "baseline", "candidate"];
const results = [];
try {
  for (const [index, variant] of sequence.entries()) {
    writeFileSync(file, variant === "baseline" ? baseline.stdout : candidate);
    rmSync("apps/app/node_modules/.vite/vitest", { recursive: true, force: true });
    const fd = openSync(join(output, `${index}-${variant}.log`), "w");
    const args = ["exec", "turbo", "run", "test", "--filter=@bb/app", "--only", "--force", "--env-mode=loose", "--continue", "--output-logs=full", "--concurrency=2"];
    const started = performance.now();
    const result = spawnSync("pnpm", args, { shell: true, env: process.env, stdio: ["ignore", fd, fd] });
    const seconds = (performance.now() - started) / 1000;
    closeSync(fd);
    results.push({ variant, seconds, status: result.status, error: result.error?.message });
    writeFileSync(join(output, "results.json"), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results.at(-1)));
  }
} finally {
  writeFileSync(file, candidate);
}
if (results.some((result) => result.status !== 0)) process.exitCode = 1;
