import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const candidate =
  process.env.RMUX_TEST_BINARY ?? resolve(testDir, "../../rmux/target/debug/rmux");

if (!existsSync(candidate)) {
  console.error(
    `real RMUX binary is required for production tests: ${candidate}`,
  );
  process.exit(1);
}

console.log(`using real RMUX binary: ${candidate}`);
