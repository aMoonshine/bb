import { readFileSync, writeFileSync } from "node:fs";
const file = "apps/app/vitest.config.ts";
const before = readFileSync(file, "utf8");
const after = before.replace('setupFiles: ["src/test/setup.ts"]', 'setupFiles: ["../../.github/scripts/profile-app-setup.ts", "src/test/setup.ts"]');
if (before === after) throw new Error("Could not install diagnostic setup");
writeFileSync(file, after);
