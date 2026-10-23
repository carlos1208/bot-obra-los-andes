// Carga .env.local para los scripts locales y permite guardar valores nuevos en él.
// «deno task» corre desde la raíz del repo, así que la ruta es relativa a ella.
import { load } from "jsr:@std/dotenv@0.225.8";

export const RUTA_ENV = ".env.local";

export async function cargarEnv(): Promise<void> {
  try {
    await Deno.stat(RUTA_ENV);
  } catch {
    console.error("No encontré .env.local. Copia .env.example a .env.local primero.");
    Deno.exit(1);
  }
  await load({ envPath: RUTA_ENV, export: true });
}

export function requerido(nombre: string): string {
  const v = Deno.env.get(nombre);
  if (!v) {
    console.error(`Falta ${nombre} en .env.local`);
    Deno.exit(1);
  }
  return v;
}

/** Escribe o reemplaza CLAVE=valor en .env.local sin mostrar el valor. */
export async function guardarEnEnv(clave: string, valor: string): Promise<void> {
  let texto = "";
  try {
    texto = await Deno.readTextFile(RUTA_ENV);
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
  const linea = `${clave}=${valor}`;
  const re = new RegExp(`^${clave}=.*$`, "m");
  texto = re.test(texto) ? texto.replace(re, () => linea) : `${texto.replace(/\n?$/, "\n")}${linea}\n`;
  await Deno.writeTextFile(RUTA_ENV, texto);
  Deno.env.set(clave, valor);
}
