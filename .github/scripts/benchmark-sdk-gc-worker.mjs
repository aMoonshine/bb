import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { getHeapStatistics } from "node:v8";
import { totalmem, freemem } from "node:os";
const initial = { heap: getHeapStatistics(), totalmem: totalmem(), freemem: freemem(), constrainedMemory: process.constrainedMemory(), availableMemory: process.availableMemory?.() };
const started = performance.now();
try {
  await import("../../packages/plugin-sdk/scripts/build-bundled-dts.mjs");
} finally {
  writeFileSync(process.env.SDK_METRICS_PATH, JSON.stringify({
    initial,
    finalHeap: getHeapStatistics(),
    seconds: (performance.now() - started) / 1000,
    resourceUsage: process.resourceUsage(),
    memoryUsage: process.memoryUsage(),
    execArgv: process.execArgv,
    version: process.version,
  }, null, 2));
}
