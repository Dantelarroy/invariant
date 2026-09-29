import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";

// Local development reads DATABASE_URL and EN16931_VALIDATOR_URL from .env;
// CI provides them as env vars. Integration tests skip when theirs is unset.
if (existsSync(".env")) process.loadEnvFile(".env");

export default defineConfig({
  test: {
    include: ["packages/**/src/**/*.test.ts", "apps/**/src/**/*.test.ts"],
  },
});
