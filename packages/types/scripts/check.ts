import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { generate, generatedDir } from "./codegen.ts";

let stale = 0;
for (const [name, content] of generate()) {
  const path = join(generatedDir, name);
  if (!existsSync(path) || readFileSync(path, "utf8") !== content) {
    console.error(`stale: packages/types/src/generated/${name}`);
    stale++;
  }
}
if (stale > 0) {
  console.error("Generated types are out of date with schema/tma.yaml. Run `pnpm schema:gen`.");
  process.exit(1);
}
console.log("schema: generated types are up to date");
