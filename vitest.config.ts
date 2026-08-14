import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    css: true,
    setupFiles: ["./src/test/setup.ts"],
    pool: "vmThreads",
    maxWorkers: 1,
    fileParallelism: false,
  },
});
