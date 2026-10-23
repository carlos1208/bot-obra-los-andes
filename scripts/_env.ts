// Carga .env.local para los scripts locales y permite guardar valores nuevos en él.
// «deno task» corre desde la raíz del repo, así que la ruta es relativa a ella.
import { load } from "jsr:@std/dotenv@0.225.8";

export const ENV_PATH = ".env.local";

export async function loadEnv(): Promise<void> {
  try {
    await Deno.stat(ENV_PATH);
  } catch {
    console.error("No encontré .env.local. Copia .env.example a .env.local primero.");
    Deno.exit(1);
  }
  await load({ envPath: ENV_PATH, export: true });
}

export function required(name: string): string {
  const v = Deno.env.get(name);
  if (!v) {
    console.error(`Falta ${name} en .env.local`);
    Deno.exit(1);
  }
  return v;
}

/** Escribe o reemplaza CLAVE=valor en .env.local sin mostrar el valor. */
export async function saveToEnv(key: string, value: string): Promise<void> {
  let content = "";
  try {
    content = await Deno.readTextFile(ENV_PATH);
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  content = re.test(content) ? content.replace(re, () => line) : `${content.replace(/\n?$/, "\n")}${line}\n`;
  await Deno.writeTextFile(ENV_PATH, content);
  Deno.env.set(key, value);
}
