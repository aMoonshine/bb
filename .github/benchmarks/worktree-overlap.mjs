import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, rmSync, openSync, closeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = process.cwd();
const output = join(process.env.RUNNER_TEMP || tmpdir(), 'worktree-overlap');
mkdirSync(output, { recursive: true });
const windows = process.platform === 'win32';
const shards = JSON.parse(readFileSync('scripts/ci-test-shards.json', 'utf8'));
const shard = shards[windows ? 'windows-tests' : 'tests'].find(x => x.shard === 'plugins-2');
const filters = shard.filter.split(/\s+/).map(x => x.replaceAll("'", ''));
const command = ['pnpm', 'exec', 'turbo', 'run', 'test', ...filters, '--only', '--force', '--output-logs=full', '--log-order=stream', `--concurrency=${windows ? 2 : 4}`, '--', '--reporter=json', '--outputFile=.ci-benchmark-tests.json'].join(' ');
const testPath = join(root, 'plugins/environment-git-worktree/host.test.ts');
const variants = Object.fromEntries(['baseline', 'candidate'].map(name => [name, readFileSync(`.github/benchmarks/worktree-${name}.txt`)]));
const order = process.env.BENCHMARK_ORDER === 'candidate-first' ? ['candidate', 'baseline', 'baseline', 'candidate'] : ['baseline', 'candidate', 'candidate', 'baseline'];
const reports = [];
for (const parent of ['plugins', 'examples/plugins']) {
  for (const entry of readdirSync(parent, { withFileTypes: true })) {
    if (entry.isDirectory()) reports.push(join(parent, entry.name, '.ci-benchmark-tests.json'));
  }
}
const rows = [];
let expected;
try {
  for (const [index, variant] of order.entries()) {
    writeFileSync(testPath, variants[variant]);
    for (const path of reports) rmSync(path, { force: true });
    const fd = openSync(join(output, `${index}-${variant}.log`), 'w');
    const started = performance.now();
    const run = windows
      ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], { cwd: root, env: process.env, stdio: ['ignore', fd, fd], timeout: 600000 })
      : spawnSync('bash', ['-lc', command], { cwd: root, env: process.env, stdio: ['ignore', fd, fd], timeout: 600000 });
    const seconds = (performance.now() - started) / 1000;
    closeSync(fd);
    const inventory = [];
    const durations = [];
    for (const path of reports.filter(existsSync)) {
      const report = JSON.parse(readFileSync(path, 'utf8'));
      const pkg = path.slice(0, -'/.ci-benchmark-tests.json'.length);
      for (const file of report.testResults) {
        const relative = file.name.slice(resolve(pkg).length).replaceAll('\\', '/');
        durations.push({ file: pkg + relative, seconds: (file.endTime - file.startTime) / 1000 });
        for (const test of file.assertionResults) inventory.push([pkg + relative, test.fullName, test.status]);
      }
    }
    inventory.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const serialized = JSON.stringify(inventory);
    expected ??= serialized;
    const row = { variant, seconds, status: run.status, error: run.error?.message, tests: inventory.length, identical: serialized === expected, inventoryHash: createHash('sha256').update(serialized).digest('hex'), worktree: durations.find(x => x.file === 'plugins/environment-git-worktree/host.test.ts') };
    rows.push(row);
    writeFileSync(join(output, `${index}-${variant}-inventory.json`), JSON.stringify(inventory, null, 2));
    writeFileSync(join(output, `${index}-${variant}-durations.json`), JSON.stringify(durations, null, 2));
    writeFileSync(join(output, 'results.json'), JSON.stringify(rows, null, 2));
    console.log(JSON.stringify(row));
    if (run.status !== 0 || !row.identical || inventory.length < 1000) throw new Error('Full plugin suite failed or inventory changed');
  }
} finally {
  writeFileSync(testPath, variants.baseline);
}
