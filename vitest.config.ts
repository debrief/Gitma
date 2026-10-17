import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (path: string): string => fileURLToPath(new URL(`./packages/${path}`, import.meta.url));
const pkg = (name: string): string => src(`${name}/src/index.ts`);

export default defineConfig({
  resolve: {
    // Exact-match aliases, so subpath exports (`@tma/features/browser`) resolve to their own sources.
    alias: [
      ...["types", "sim", "data", "features", "classical", "eval", "models", "demos"].map(
        (name) => ({
          find: new RegExp(`^@tma/${name}$`),
          replacement: pkg(name),
        }),
      ),
      { find: /^@tma\/features\/browser$/, replacement: src("features/src/browser.ts") },
      { find: /^@tma\/classical\/browser$/, replacement: src("classical/src/browser.ts") },
      { find: /^@tma\/eval\/browser$/, replacement: src("eval/src/browser.ts") },
      { find: /^@tma\/data\/canonical$/, replacement: src("data/src/canonical.ts") },
      { find: /^@tma\/demos\/viewer$/, replacement: src("demos/src/viewer/index.ts") },
    ],
  },
  test: {
    include: ["packages/*/test/**/*.test.ts", "packages/*/test/**/*.test.tsx"],
    passWithNoTests: true,
    // CPU-heavy solver tests share 2–4 cores with tfjs training tests; 5 s is too tight on CI.
    testTimeout: 60_000,
  },
});
