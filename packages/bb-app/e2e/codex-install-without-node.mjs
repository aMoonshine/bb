import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import {
  appendFile,
  copyFile,
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

if (process.env.GITHUB_ACTIONS !== "true" || process.platform !== "win32") {
  throw new Error("Run only on a disposable Windows GitHub Actions runner");
}

const exec = promisify(execFile);
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const resultsDir = resolve(
  process.env.CODEX_INSTALL_RESULTS ?? "codex-install-results",
);
const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
const powershell = join(
  systemRoot,
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe",
);
const minimalPath = [
  join(systemRoot, "System32"),
  systemRoot,
  dirname(powershell),
].join(";");
const report = { sha: process.env.GITHUB_SHA, checks: [], status: "failed" };
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
let root;
let launcher;
let savedPaths;
let stage = "prepare isolated runner";

function pass(check) {
  report.checks.push(check);
  process.stdout.write(`PASS: ${check}\n`);
}

async function ps(script, env = process.env) {
  const { stdout } = await exec(
    powershell,
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `$ErrorActionPreference='Stop'; ${script}`,
    ],
    {
      env,
      timeout: 30_000,
      windowsHide: true,
    },
  );
  return stdout.trim();
}

async function freePort() {
  const socket = createServer();
  await new Promise((done, reject) => {
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", done);
  });
  const address = socket.address();
  assert(address && typeof address !== "string");
  await new Promise((done) => socket.close(done));
  return address.port;
}

async function assertAbsent(env) {
  for (const name of ["node", "npm", "codex"]) {
    const result = await exec(
      join(systemRoot, "System32", "where.exe"),
      [name],
      {
        env,
        cwd: root,
        timeout: 10_000,
        windowsHide: true,
      },
    ).then(
      () => true,
      (error) => {
        assert.equal(
          error.code,
          1,
          `where ${name} must run and report no executable`,
        );
        return false;
      },
    );
    assert.equal(result, false, `${name} must not be on PATH`);
  }
}

async function stop() {
  if (!launcher?.pid || launcher.exitCode !== null) return;
  await exec(
    join(systemRoot, "System32", "taskkill.exe"),
    ["/pid", String(launcher.pid), "/T", "/F"],
    { windowsHide: true, timeout: 15_000 },
  );
  const deadline = Date.now() + 15_000;
  while (
    launcher.exitCode === null &&
    launcher.signalCode === null &&
    Date.now() < deadline
  )
    await delay(100);
  assert(
    launcher.exitCode !== null || launcher.signalCode !== null,
    "Owned bb process must exit",
  );
}

try {
  await mkdir(resultsDir, { recursive: true });
  root = await mkdtemp(join(tmpdir(), "bb Codex O'Brien "));
  const runtime = join(root, "bb-runtime.exe");
  await copyFile(process.execPath, runtime);
  const dataDir = join(root, "data");
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      /^(?:OS|SystemRoot|WINDIR|COMSPEC|PATHEXT|ProgramFiles|ProgramFiles\(x86\)|ProgramData|PROCESSOR_ARCHITECTURE|NUMBER_OF_PROCESSORS|TEMP|TMP)$/iu.test(
        key,
      ),
    ),
  );
  Object.assign(env, {
    HOME: root,
    USERPROFILE: root,
    APPDATA: join(root, "AppData", "Roaming"),
    LOCALAPPDATA: join(root, "AppData", "Local"),
    CODEX_HOME: join(root, ".codex"),
    PATH: minimalPath,
    SHELL: powershell,
    NO_COLOR: "1",
    CI: "true",
    BB_TELEMETRY: "false",
  });
  await mkdir(env.APPDATA, { recursive: true });
  await mkdir(env.LOCALAPPDATA, { recursive: true });
  savedPaths = JSON.parse(
    await ps(
      "@{ User=[Environment]::GetEnvironmentVariable('Path','User'); Machine=[Environment]::GetEnvironmentVariable('Path','Machine') } | ConvertTo-Json -Compress",
    ),
  );
  await ps(
    "[Environment]::SetEnvironmentVariable('Path',$env:PATH,'Machine'); [Environment]::SetEnvironmentVariable('Path',$null,'User')",
    env,
  );
  await assertAbsent(env);
  pass(
    "Node.js, npm and Codex absent from the isolated PATH and registry PATH",
  );

  stage = "red before: original npm installation";
  const old = await exec(
    join(systemRoot, "System32", "cmd.exe"),
    ["/d", "/s", "/c", "npm.cmd install -g @openai/codex@latest"],
    {
      env,
      cwd: root,
      timeout: 30_000,
      windowsHide: true,
    },
  ).then(
    () => null,
    (error) => error,
  );
  assert(old, "Original npm install must fail");
  assert.equal(old.code, 1);
  assert.match(old.stderr, /npm\.cmd.*not recognized/isu);
  pass(
    "Red before: npm.cmd install -g @openai/codex@latest fails because npm is absent",
  );

  stage = "boot real bb server and daemon";
  const serverPort = await freePort();
  const daemonPort = await freePort();
  const serverUrl = `http://127.0.0.1:${serverPort}`;
  const cliEnv = {
    ...env,
    BB_DATA_DIR: dataDir,
    BB_SERVER_URL: serverUrl,
    BB_HOST_DAEMON_PORT: String(daemonPort),
  };
  const cli = async (args) =>
    JSON.parse(
      (
        await exec(runtime, [join(packageRoot, "dist", "bb.js"), ...args], {
          env: cliEnv,
          cwd: root,
          timeout: 30_000,
          maxBuffer: 4 * 1024 * 1024,
          windowsHide: true,
        })
      ).stdout,
    );
  const api = async (path, options = {}) => {
    const response = await fetch(`${serverUrl}/api/v1${path}`, {
      ...options,
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(600_000),
    });
    assert(response.ok, `API request failed (${response.status})`);
    return options.ndjson
      ? (await response.text())
          .trim()
          .split(/\r?\n/u)
          .filter(Boolean)
          .map((line) => JSON.parse(line))
      : response.json();
  };
  launcher = spawn(
    runtime,
    [
      join(packageRoot, "dist", "bb-app.js"),
      "--data-dir",
      dataDir,
      "--server-port",
      String(serverPort),
      "--host-daemon-port",
      String(daemonPort),
      "--bundled",
    ],
    {
      env: { ...env, NODE_ENV: "production" },
      cwd: root,
      stdio: "ignore",
      windowsHide: true,
    },
  );
  let spawnError;
  launcher.on("error", (error) => {
    spawnError = error;
  });
  let hostId;
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    assert(!spawnError && launcher.exitCode === null, "bb must remain running");
    try {
      const status = await cli(["status", "--json"]);
      assert.equal(status.dataDir, dataDir);
      const hosts = await cli(["machine", "list", "--json"]);
      const plugins = await cli(["plugin", "list", "--json"]);
      if (
        hosts.length === 1 &&
        hosts[0].status === "connected" &&
        ["provider-codex", "provider-pi"].every((id) =>
          plugins.plugins.some(
            (plugin) => plugin.id === id && plugin.status === "running",
          ),
        )
      ) {
        hostId = hosts[0].id;
        break;
      }
    } catch {}
    await delay(1_000);
  }
  assert(hostId, "bb must connect its daemon and provider plugins");
  await api("/settings/machine-environment", {
    method: "POST",
    body: JSON.stringify({
      name: "PATH",
      value: minimalPath,
      note: "First-run CI isolation",
    }),
  });
  const installation = async () => api(`/hosts/${hostId}/provider-clis/status`);
  const health = async () =>
    (await api(`/system/providers/state?hostId=${hostId}`)).providers.find(
      (provider) => provider.providerId === "codex",
    );
  const before = await installation();
  assert.equal(before.codex.installed, false);
  assert.equal(before.codex.installAction?.kind, "install");
  assert.equal((await health()).status, "not_installed");
  assert.equal(before.pi.installed, false);
  assert.equal(before.pi.installAction, null);
  assert.equal(before.pi.missingPrerequisite, "nodejs");
  pass(
    "Fresh setup offers Codex Install and reports Pi's missing Node.js prerequisite",
  );

  stage = "green after: real native installation through setup route";
  const events = await api(`/hosts/${hostId}/provider-clis/install`, {
    method: "POST",
    body: JSON.stringify({ provider: "codex", actionKind: "install" }),
    ndjson: true,
  });
  assert.match(
    events.find((event) => event.type === "started")?.command ?? "",
    /https:\/\/chatgpt\.com\/codex\/install\.ps1/u,
  );
  assert.equal(
    events.some((event) => event.type === "error"),
    false,
    "Install route must not report errors",
  );
  assert.equal(
    events.findLast((event) => event.type === "completed")?.success,
    true,
    "Native installer and bb verification must succeed",
  );
  const installed = (await installation()).codex;
  assert.equal(installed.installed, true);
  assert(installed.executablePath);
  assert(installed.currentVersion);
  const version = await exec(installed.executablePath, ["--version"], {
    env,
    cwd: root,
    timeout: 30_000,
    windowsHide: true,
  });
  assert.match(version.stdout, /codex-cli \d+\.\d+\.\d+/u);
  assert(version.stdout.includes(installed.currentVersion));
  pass(
    "Green after: setup installs real native Codex and its executable reports a version",
  );

  stage = "discover native executable before PATH refresh";
  await ps("[Environment]::SetEnvironmentVariable('Path',$null,'User')", env);
  await assertAbsent(env);
  const state = await health();
  assert.equal(state.status, "unauthenticated");
  assert.equal(state.installedVersion, installed.currentVersion);
  assert.equal(
    (await installation()).codex.executablePath,
    installed.executablePath,
  );
  const login = await ps(`${state.localLoginCommand} --help`, env);
  assert.match(login, /login/iu);
  const launch = await exec(
    installed.executablePath,
    ["app-server", "--help"],
    { env, cwd: root, timeout: 30_000, windowsHide: true },
  );
  assert.match(launch.stdout, /app-server/iu);
  pass(
    "Native status, PowerShell sign-in command and app-server launch work before PATH refresh, including spaces and apostrophes",
  );
  pass(
    "Provider health is installed and unauthenticated; no credentials or sign-in completion used",
  );
  report.status = "passed";
} catch {
  report.failedStage = stage;
  process.stderr.write(
    `FAIL: ${stage}; raw process output withheld from public artifacts\n`,
  );
  process.exitCode = 1;
} finally {
  try {
    await stop();
  } catch {
    report.cleanupFailed = true;
    process.exitCode = 1;
  }
  if (savedPaths) {
    try {
      await ps(
        "[Environment]::SetEnvironmentVariable('Path',$env:RESTORE_USER_PATH,'User'); [Environment]::SetEnvironmentVariable('Path',$env:RESTORE_MACHINE_PATH,'Machine')",
        {
          ...process.env,
          RESTORE_USER_PATH: savedPaths.User ?? "",
          RESTORE_MACHINE_PATH: savedPaths.Machine ?? "",
        },
      );
    } catch {
      report.registryRestoreFailed = true;
      process.exitCode = 1;
    }
  }
  if (root)
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 500,
    }).catch(() => {
      report.cleanupFailed = true;
      process.exitCode = 1;
    });
  if (process.exitCode) report.status = "failed";
  await mkdir(resultsDir, { recursive: true });
  await writeFile(
    join(resultsDir, "windows.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  const summary = `## Codex installation without Node.js: ${report.status}\n\n${report.checks.map((check) => `- PASS: ${check}`).join("\n")}\n${report.failedStage ? `\nFailed stage: ${report.failedStage}\n` : ""}\nUses the real setup API, daemon and upstream installer. bb's private runtime is invoked by absolute path; Node.js and npm are unavailable to installation commands. OAuth completion is outside this check.\n`;
  await writeFile(join(resultsDir, "windows.md"), summary);
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
}
