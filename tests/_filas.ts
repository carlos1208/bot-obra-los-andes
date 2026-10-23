import type { Fila } from "../supabase/functions/_shared/obra.ts";
import { filasAObjetos } from "../supabase/functions/_shared/sheets.ts";

/** Lee un CSV de semillas/ y lo convierte en filas como las devuelve la hoja. */
export async function filasDeSemilla(nombre: string): Promise<Fila[]> {
  const { parse } = await import("jsr:@std/csv@1.0.6");
  const texto = await Deno.readTextFile(new URL(`../semillas/${nombre}.csv`, import.meta.url));
  return filasAObjetos(parse(texto));
}

let n = 2;
export function fila(datos: Record<string, unknown>): Fila {
  return { _fila: n++, ...datos };
}
