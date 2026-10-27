import { Session } from "node:inspector/promises";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, expect } from "vitest";

let session: Session | undefined;
let testPath = "";
beforeAll(async () => {
  testPath = expect.getState().testPath ?? "unknown";
  session = new Session();
  session.connect();
  await session.post("Profiler.enable");
  await session.post("Profiler.start");
});
afterAll(async () => {
  if (!session) return;
  const { profile } = await session.post("Profiler.stop");
  const name = `${process.pid}-${path.basename(testPath)}.cpuprofile`;
  writeFileSync(path.join(process.env.RUNNER_TEMP!, "app-profile", name), JSON.stringify(profile));
  session.disconnect();
});
