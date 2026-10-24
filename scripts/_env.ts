// Carga .env.local para los scripts locales y permite guardar valores nuevos en él.
// «deno task» corre desde la raíz del repo, así que la ruta es relativa a ella.
import { parse } from "jsr:@std/dotenv@0.225.8";

export const ENV_PATH = ".env.local";

let fileValues: Record<string, string> = {};

/** Lee .env.local en UTF-8 o UTF-16 (el Bloc de notas puede guardar en cualquiera). */
async function readEnvFile(): Promise<string> {
  const bytes = await Deno.readFile(ENV_PATH);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  return new TextDecoder().decode(bytes); // TextDecoder ya quita el BOM de UTF-8
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function loadEnv(): Promise<void> {
  if (!(await exists(ENV_PATH))) {
    console.error("No encontré .env.local. Copia .env.example a .env.local primero.");
    if (await exists(`${ENV_PATH}.txt`)) {
      console.error("Hay un .env.local.txt: el Bloc de notas le agregó «.txt». Renómbralo con:");
      console.error("  Rename-Item .env.local.txt .env.local");
    }
    Deno.exit(1);
  }
  fileValues = parse(await readEnvFile());
  for (const [k, v] of Object.entries(fileValues)) {
    if (Deno.env.get(k) === undefined) Deno.env.set(k, v);
  }
}

export function required(name: string): string {
  const v = Deno.env.get(name);
  if (v) return v;
  if (name in fileValues) {
    console.error(`En .env.local la línea ${name}= está vacía. Pon el valor después del «=» y guarda.`);
  } else {
    console.error(`En .env.local no hay una línea ${name}=. Agrégala o copia la de .env.example.`);
  }
  Deno.exit(1);
}

/** Escribe o reemplaza CLAVE=valor en .env.local (en UTF-8) sin mostrar el valor. */
export async function saveToEnv(key: string, value: string): Promise<void> {
  const content = (await exists(ENV_PATH)) ? await readEnvFile() : "";
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  const updated = re.test(content) ? content.replace(re, () => line) : `${content.replace(/\r?\n?$/, "\n")}${line}\n`;
  await Deno.writeTextFile(ENV_PATH, updated);
  Deno.env.set(key, value);
}
