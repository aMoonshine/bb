import { cpSync } from "node:fs";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
const exec = promisify(execFile);
const root = await fs.mkdtemp(join(process.env.RUNNER_TEMP, "bb-copy-cost-"));
const results = [];
async function initialize(repoDir) {
  await fs.mkdir(repoDir, { recursive: true });
  const git = (args) => exec("git", args, { cwd: repoDir });
  await git(["init", "--initial-branch", "main"]);
  await git(["config", "user.email", "integration-tests@example.com"]);
  await git(["config", "user.name", "BB Integration Tests"]);
  await fs.writeFile(join(repoDir, "alpha.txt"), "alpha\n");
  await fs.writeFile(join(repoDir, "beta.md"), "# Beta\n\nInitial content.\n");
  await git(["add", "."]);
  await git(["commit", "-m", "Initial commit"]);
}
try {
  const template = join(root, "template");
  await initialize(template);
  for (let round = 0; round < 6; round++) {
    const order = round % 2 === 0 ? ["initialize", "async", "sync"] : ["sync", "async", "initialize"];
    for (const variant of order) {
      const start = performance.now();
      for (let i = 0; i < 10; i++) {
        const target = join(root, `${round}-${variant}-${i}`);
        if (variant === "initialize") await initialize(target);
        else if (variant === "async") await fs.cp(template, target, { recursive: true });
        else cpSync(template, target, { recursive: true });
      }
      results.push({ round, variant, seconds: (performance.now() - start) / 1000 });
      console.log(JSON.stringify(results.at(-1)));
    }
  }
} finally {
  await fs.writeFile(join(process.env.RUNNER_TEMP, "git-copy-cost.json"), JSON.stringify(results, null, 2));
  await fs.rm(root, { recursive: true, force: true });
}
