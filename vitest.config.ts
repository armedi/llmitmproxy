import { defineConfig } from "vitest/config";

// Kept apart from vite.config.ts so tests don't load TanStack Start and the dev backend.
export default defineConfig({
  test: { include: ["test/**/*.test.{ts,tsx}"] },
});
