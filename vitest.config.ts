import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "e2e/**", "work/**", "**/work/**"],
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
  },
});
