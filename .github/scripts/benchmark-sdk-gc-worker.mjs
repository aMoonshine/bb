import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
const started = performance.now();
try {
  await import("../../packages/plugin-sdk/scripts/build-bundled-dts.mjs");
} finally {
  writeFileSync(process.env.SDK_METRICS_PATH, JSON.stringify({
    seconds: (performance.now() - started) / 1000,
    resourceUsage: process.resourceUsage(),
    memoryUsage: process.memoryUsage(),
    execArgv: process.execArgv,
    version: process.version,
  }, null, 2));
}
