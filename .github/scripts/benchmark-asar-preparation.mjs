import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, openSync, closeSync } from "node:fs";
import { lstat, readdir, readFile, readlink } from "node:fs/promises";
import { join, resolve, relative } from "node:path";
const root = process.cwd();
const req = createRequire(resolve("apps/desktop/node_modules/electron-builder/package.json"));
const target = req.resolve("app-builder-lib/out/asar/asarUtil.js");
const baseline = readFileSync(target);
const candidate = readFileSync(".github/scripts/candidate-asar-util.cjs");
const output = join(process.env.RUNNER_TEMP, "asar-benchmark");
mkdirSync(output, { recursive: true });
const resources = resolve("apps/desktop/release/win-unpacked/resources");
async function inventory() {
  const entries = [];
  async function visit(file) {
    const stat = await lstat(file);
    const name = relative(resources, file).replaceAll("\\", "/");
    const mode = stat.mode & 0o777;
    if (stat.isDirectory()) {
      entries.push([name, mode, "directory"]);
      for (const child of (await readdir(file)).sort()) await visit(join(file, child));
    } else if (stat.isSymbolicLink()) entries.push([name, mode, "link", await readlink(file)]);
    else entries.push([name, mode, "file", createHash("sha256").update(await readFile(file)).digest("hex")]);
  }
  await visit(join(resources, "app.asar"));
  await visit(join(resources, "app.asar.unpacked"));
  return entries;
}
const expected = await inventory();
writeFileSync(join(output, "baseline-inventory.json"), JSON.stringify(expected));
const sequence = process.env.BENCHMARK_ORDER === "baseline-first" ? ["baseline", "candidate", "candidate", "baseline"] : ["candidate", "baseline", "baseline", "candidate"];
const results = [];
try {
  for (const [index, variant] of sequence.entries()) {
    writeFileSync(target, variant === "baseline" ? baseline : candidate);
    const fd = openSync(join(output, `${index}-${variant}.log`), "w");
    const start = performance.now();
    const build = spawnSync("pnpm", ["exec", "turbo", "run", "package:win", "--filter=@bb/desktop", "--only", "--force", "--env-mode=loose", "--output-logs=full", "--log-order=stream"], { shell: true, env: process.env, stdio: ["ignore", fd, fd] });
    const seconds = (performance.now()-start)/1000;
    closeSync(fd);
    if (build.status !== 0) throw new Error("Packaging failed");
    const actual = await inventory();
    const identical = JSON.stringify(expected) === JSON.stringify(actual);
    writeFileSync(join(output, `${index}-${variant}-inventory.json`), JSON.stringify(actual));
    const smokeFd = openSync(join(output, `${index}-${variant}-smoke.log`), "w");
    const smoke = spawnSync("pnpm", ["exec", "turbo", "run", "smoke:packaged", "--filter=@bb/desktop", "--force", "--env-mode=loose", "--output-logs=full"], { shell: true, env: process.env, stdio: ["ignore", smokeFd, smokeFd] });
    closeSync(smokeFd);
    results.push({ variant, seconds, identical, entries: actual.length, archive: actual[0], smokeStatus: smoke.status });
    writeFileSync(join(output, "results.json"), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results.at(-1)));
    if (!identical || smoke.status !== 0) throw new Error("Artifact differs or smoke failed");
  }
} finally { writeFileSync(target, baseline); }
