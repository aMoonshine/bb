import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { experimental_hostToolchain as hostToolchain } from "@get-bb/plugin-sdk/process";
import {
  managedPiDirectory,
  managedPiEntry,
  managedPiExecutable,
} from "./managed-pi.js";
import { resolvePiProcessLaunch } from "./rpc-child.js";

let home: string;
let packageDir: string;
beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), "pi-runtime-"));
  vi.stubEnv("HOME", home);
  vi.stubEnv("USERPROFILE", home);
  vi.stubEnv("BB_PI_BRIDGE_COMMAND", "");
  vi.spyOn(hostToolchain, "resolve").mockReturnValue(null);
  packageDir = path.join(
    managedPiDirectory(),
    "node_modules",
    "@earendil-works",
    "pi-coding-agent",
  );
  await mkdir(packageDir, { recursive: true });
  await writeFile(managedPiExecutable(), "launcher");
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(home, { recursive: true, force: true });
});

it("uses the manifest executable and bb runtime without a node or pi on PATH", async () => {
  const entry = path.join(packageDir, "new-cli.js");
  await writeFile(entry, "");
  await writeFile(
    path.join(packageDir, "package.json"),
    JSON.stringify({ bin: { pi: "new-cli.js" } }),
  );
  expect(resolvePiProcessLaunch(process.env)).toEqual({
    command: hostToolchain.node(),
    args: [entry],
  });
  expect(
    resolvePiProcessLaunch({
      ...process.env,
      BB_PI_BRIDGE_COMMAND: "custom-pi",
      BB_PI_BRIDGE_ARGS: '["custom"]',
    }),
  ).toEqual({ command: "custom-pi", args: ["custom"] });
});

it("rejects missing and escaped manifest executables", async () => {
  await writeFile(
    path.join(packageDir, "package.json"),
    JSON.stringify({ bin: { pi: "missing.js" } }),
  );
  expect(managedPiEntry()).toBeNull();
  await writeFile(path.join(packageDir, "..", "outside.js"), "");
  await writeFile(
    path.join(packageDir, "package.json"),
    JSON.stringify({ bin: { pi: "../outside.js" } }),
  );
  expect(managedPiEntry()).toBeNull();
});
