import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";

// Local development reads DATABASE_URL from .env; CI provides it as an env var.
if (existsSync(".env")) process.loadEnvFile(".env");

export default defineConfig({
  test: {
    include: ["packages/**/src/**/*.test.ts", "apps/**/src/**/*.test.ts"],
  },
});
