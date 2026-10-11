import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generate, generatedDir } from "./codegen.ts";

mkdirSync(generatedDir, { recursive: true });
for (const [name, content] of generate()) {
  writeFileSync(join(generatedDir, name), content);
  console.log(`wrote packages/types/src/generated/${name}`);
}
