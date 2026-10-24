// Sube a Supabase los secretos de .env.local que tienen valor (sin PROJECT_REF ni líneas vacías).
// Uso: deno task secretos            (con --solo-nombres muestra qué subiría, sin subir nada)
import { parse } from "jsr:@std/dotenv@0.225.8";
import { loadEnv, required } from "./_env.ts";

await loadEnv();
const projectRef = required("PROJECT_REF");
const LOCAL_ONLY = new Set(["PROJECT_REF"]);

const names = Object.keys(parse(await Deno.readTextFile(".env.example")))
  .filter((k) => !LOCAL_ONLY.has(k) && Deno.env.get(k));

if (Deno.args.includes("--solo-nombres")) {
  console.log(names.join("\n"));
  Deno.exit(0);
}

// Archivo temporal en formato .env: cada valor entre comillas, con los saltos de línea como \n.
const quoteValue = (v: string) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, "\\n")}"`;
const tmp = await Deno.makeTempFile({ suffix: ".env" });
try {
  await Deno.writeTextFile(tmp, names.map((k) => `${k}=${quoteValue(Deno.env.get(k)!)}`).join("\n") + "\n");
  const args = ["supabase", "secrets", "set", "--env-file", tmp, "--project-ref", projectRef];
  const cmd = Deno.build.os === "windows"
    ? new Deno.Command("cmd", { args: ["/c", "npx", ...args] })
    : new Deno.Command("npx", { args });
  const { code } = await cmd.spawn().status;
  if (code !== 0) Deno.exit(code);
  console.log(`\nListo: ${names.length} secretos en Supabase.`);
} finally {
  await Deno.remove(tmp);
}
