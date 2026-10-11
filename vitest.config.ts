import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const pkg = (name: string): string =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@tma/types": pkg("types"),
      "@tma/sim": pkg("sim"),
      "@tma/data": pkg("data"),
      "@tma/features": pkg("features"),
      "@tma/classical": pkg("classical"),
      "@tma/eval": pkg("eval"),
      "@tma/models": pkg("models"),
    },
  },
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    passWithNoTests: true,
  },
});
