/**
 * Before the browser tests: reset and seed the TEST database (same guarded reset as `npm test`,
 * tests/support/global-setup.ts) and empty the e2e mailbox and file folders. Never touches the
 * dev database.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import setup from "../tests/support/global-setup";

async function main() {
  const scratch = path.join(os.tmpdir(), "tig-carrier-intelligence-e2e");
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(path.join(scratch, "inbox"), { recursive: true });
  // A fresh build cache each run: a stale one (after a file is deleted or renamed) makes pages reload in a loop.
  fs.rmSync(path.join(process.cwd(), ".next-e2e"), { recursive: true, force: true });
  await setup();
  console.log("E2E test database ready.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
