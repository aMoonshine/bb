import { readFileSync, writeFileSync } from "node:fs";
function wrap(file, names) {
  let source = readFileSync(file, "utf8");
  for (const name of names) {
    const exported = source.includes(`export async function ${name}(`);
    const prefix = exported ? "export " : "";
    const signature = `${prefix}async function ${name}(`;
    if (!source.includes(signature)) throw new Error(`Missing ${name}`);
    source = source.replace(signature, `async function measuredOriginal_${name}(`);
    source += `\n${prefix}async function ${name}(...args) {\n  const started = performance.now();\n  console.log("MEASURE START ${name}", new Date().toISOString());\n  try { return await measuredOriginal_${name}(...args); } finally { console.log("MEASURE END ${name}", ((performance.now() - started) / 1000).toFixed(3)); }\n}\n`;
  }
  writeFileSync(file, source);
}
wrap("apps/desktop/scripts/prepare-native-modules.cjs", ["findPackageDirectories", "preparePackagedNativeModules", "prepareBetterSqlite3PackageDirectory", "prepareParcelWatcherPackageDirectory"]);
wrap("apps/desktop/scripts/smoke-packaged-npm.mjs", ["hashPackagedResources", "smokePackagedNpm"]);
wrap("apps/desktop/scripts/run-electron-builder.mjs", ["runElectronBuilder"]);

const runner = "apps/desktop/scripts/run-electron-builder.mjs";
const originalRunner = readFileSync(runner, "utf8");
const profiledRunner = originalRunner.replace('[electronBuilderCli, "--config", generatedConfigPath, ...args]', '["--cpu-prof", `--cpu-prof-dir=${process.env.RUNNER_TEMP}/desktop-timings`, "--require", resolve(desktopPackageRoot, "../../.github/scripts/profile-desktop-builder.cjs"), electronBuilderCli, "--config", generatedConfigPath, ...args]');
if (profiledRunner === originalRunner) throw new Error("Missing builder invocation");
writeFileSync(runner, profiledRunner);
