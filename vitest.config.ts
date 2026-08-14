import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/test/**/*.{test,spec}.{ts,tsx}"],
    environment: "node",
    globals: true,
    css: true,
    setupFiles: ["./src/test/setup.ts"],
    pool: "vmThreads",
    maxWorkers: 1,
    fileParallelism: false,
  },
});
