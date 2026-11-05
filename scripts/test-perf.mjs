// Runs the search performance tests on a freshly reset test database: `npm run test:perf`.
import { spawnSync } from "node:child_process";
const r = spawnSync("npx vitest run", { stdio: "inherit", shell: true, env: { ...process.env, PERF: "1" } });
process.exit(r.status ?? 1);
