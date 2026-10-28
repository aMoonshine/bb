const { createRequire } = require("node:module");
const { writeFileSync } = require("node:fs");
const path = require("node:path");
const v8 = require("node:v8");
const req = createRequire(require.resolve("electron-builder/package.json", { paths: [process.cwd()] }));
function wrap(object, key, label) {
  const original = object[key];
  if (typeof original !== "function") throw new Error(`Missing ${label}`);
  let active = 0;
  let started = 0;
  let calls = 0;
  object[key] = function (...args) {
    if (active++ === 0) { started = performance.now(); calls = 0; console.log("PHASE START", label, new Date().toISOString()); }
    calls++;
    const finish = () => { if (--active === 0) console.log("PHASE END", label, ((performance.now() - started) / 1000).toFixed(3), "calls", calls); };
    let value;
    try { value = original.apply(this, args); } catch (error) { finish(); throw error; }
    if (value && typeof value.then === "function") return value.finally(finish);
    finish();
    return value;
  };
}
for (const [file, exported, methods] of [
  ["node-module-collector/nodeModulesCollector", "NodeModulesCollector", ["getNodeModules", "getDependenciesTree", "transformToHoisterTree", "_getNodeModules"]],
  ["node-module-collector/pnpmNodeModulesCollector", "PnpmNodeModulesCollector", ["collectAllDependencies", "extractProductionDependencyGraph"]],
  ["asar/asarUtil", "AsarPackager", ["pack", "processFileSets", "executeElectronAsar"]],
]) {
  const object = req(`app-builder-lib/out/${file}.js`)[exported].prototype;
  for (const method of methods) wrap(object, method, `${exported}.${method}`);
}
for (const [file, methods] of [
  ["util/appFileCopier", ["computeFileSets", "computeNodeModuleFileSets", "transformFiles", "copyAppFiles"]],
  ["util/electronGet", ["downloadElectronArtifactZip", "extractArchive"]],
  ["asar/integrity", ["computeData"]],
  ["node-module-collector/hoist", ["hoist"]],
]) {
  const object = req(`app-builder-lib/out/${file}.js`);
  for (const method of methods) wrap(object, method, `${file}.${method}`);
}
console.log("BUILDER HEAP LIMIT", v8.getHeapStatistics().heap_size_limit);
process.on("exit", () => writeFileSync(path.join(process.env.RUNNER_TEMP, "desktop-timings", `builder-${process.pid}.json`), JSON.stringify({ resourceUsage: process.resourceUsage(), memoryUsage: process.memoryUsage(), heap: v8.getHeapStatistics() }, null, 2)));
