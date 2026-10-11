// LinkML → JSON Schema → zod code generation (research R1).
// json-schema-to-zod cannot resolve $ref between $defs, so this small emitter is used instead.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
export const generatedDir = fileURLToPath(new URL("../src/generated/", import.meta.url));

interface JsonSchema {
  $ref?: string;
  anyOf?: JsonSchema[];
  type?: string | string[];
  items?: JsonSchema;
  enum?: string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  description?: string;
}

interface RootSchema {
  version: string;
  $defs: Record<string, JsonSchema>;
}

const HEADER =
  "// GENERATED from schema/tma.yaml by packages/types/scripts/generate.ts. Do not edit.\n";

function refName(ref: string): string {
  const name = ref.split("/").at(-1);
  if (name === undefined) throw new Error(`bad $ref ${ref}`);
  return name;
}

function deps(schema: JsonSchema, out: Set<string>): Set<string> {
  if (schema.$ref !== undefined) out.add(refName(schema.$ref));
  if (schema.items !== undefined) deps(schema.items, out);
  for (const s of schema.anyOf ?? []) deps(s, out);
  for (const p of Object.values(schema.properties ?? {})) deps(p, out);
  return out;
}

function topoOrder(defs: Record<string, JsonSchema>): string[] {
  const order: string[] = [];
  const state = new Map<string, "visiting" | "done">();
  const visit = (name: string): void => {
    const s = state.get(name);
    if (s === "done") return;
    if (s === "visiting") throw new Error(`recursive type ${name} is not supported`);
    state.set(name, "visiting");
    const def = defs[name];
    if (def === undefined) throw new Error(`unknown type ${name}`);
    for (const d of [...deps(def, new Set())].sort()) visit(d);
    state.set(name, "done");
    order.push(name);
  };
  for (const name of Object.keys(defs).sort()) visit(name);
  return order;
}

function baseType(schema: JsonSchema): { expr: string; nullable: boolean } {
  if (schema.$ref !== undefined) return { expr: refName(schema.$ref), nullable: false };
  if (schema.anyOf !== undefined) {
    const nonNull = schema.anyOf.filter((s) => s.type !== "null");
    const only = nonNull[0];
    if (nonNull.length !== 1 || only === undefined) throw new Error("unsupported anyOf");
    return { expr: baseType(only).expr, nullable: nonNull.length < schema.anyOf.length };
  }
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const nullable = types.includes("null");
  const t = types.filter((x) => x !== "null");
  if (t.length !== 1) throw new Error(`unsupported type ${JSON.stringify(schema.type)}`);
  switch (t[0]) {
    case "string":
      return { expr: "z.string()", nullable };
    case "number":
      return { expr: "z.number()", nullable };
    case "integer":
      return { expr: "z.number().int()", nullable };
    case "boolean":
      return { expr: "z.boolean()", nullable };
    case "array":
      if (schema.items === undefined) throw new Error("array without items");
      return { expr: `z.array(${baseType(schema.items).expr})`, nullable };
    default:
      throw new Error(`unsupported type ${String(t[0])}`);
  }
}

function comment(text: string | undefined, indent: string): string {
  if (text === undefined || text.trim() === "") return "";
  return `${indent}/** ${text.replaceAll("*/", "* /").replaceAll("\n", " ")} */\n`;
}

function emitDef(name: string, def: JsonSchema): string {
  let body: string;
  if (def.enum !== undefined) {
    body = `z.enum([${def.enum.map((v) => JSON.stringify(v)).join(", ")}])`;
  } else {
    const required = new Set(def.required ?? []);
    const fields = Object.entries(def.properties ?? {}).map(([key, prop]) => {
      const { expr, nullable } = baseType(prop);
      const suffix = required.has(key) ? "" : nullable ? ".nullish()" : ".optional()";
      return `${comment(prop.description, "  ")}  ${key}: ${expr}${suffix},\n`;
    });
    body = `z.strictObject({\n${fields.join("")}})`;
  }
  return (
    `${comment(def.description, "")}export const ${name} = ${body};\n` +
    `export type ${name} = z.infer<typeof ${name}>;\n`
  );
}

export function runLinkml(): RootSchema {
  const out = execFileSync("uv", ["run", "--frozen", "gen-json-schema", "schema/tma.yaml"], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return JSON.parse(out) as RootSchema;
}

/** Returns generated file name → content. */
export function generate(): Map<string, string> {
  const root = runLinkml();
  const files = new Map<string, string>();
  files.set("tma.schema.json", `${JSON.stringify(root, null, 2)}\n`);
  const defs = topoOrder(root.$defs).map((n) => {
    const def = root.$defs[n];
    if (def === undefined) throw new Error(n);
    return emitDef(n, def);
  });
  files.set("zod.ts", `${HEADER}import { z } from "zod";\n\n${defs.join("\n")}`);
  files.set(
    "version.ts",
    `${HEADER}export const SCHEMA_VERSION = ${JSON.stringify(root.version)};\n`,
  );
  return files;
}
