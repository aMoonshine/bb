import { writeFileSync } from "node:fs";
import { getHeapStatistics } from "node:v8";
const initial = getHeapStatistics();
const started = performance.now();
await import("../../packages/bb-app/scripts/build-public-sdk-dts.mjs");
writeFileSync(process.env.PUBLIC_SDK_METRICS, JSON.stringify({ initial, final: getHeapStatistics(), seconds: (performance.now()-started)/1000, resourceUsage: process.resourceUsage(), memoryUsage: process.memoryUsage() }, null, 2));
