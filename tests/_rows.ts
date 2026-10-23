import { toRows } from "../supabase/functions/_shared/sheets.ts";
import type { Row } from "../supabase/functions/_shared/site.ts";

/** Lee un CSV de semillas/ y lo convierte en filas como las devuelve la hoja. */
export async function seedRows(tab: string): Promise<Row[]> {
  const { parse } = await import("jsr:@std/csv@1.0.6");
  const text = await Deno.readTextFile(new URL(`../semillas/${tab}.csv`, import.meta.url));
  return toRows(parse(text));
}

let next = 2;
export function row(data: Record<string, unknown>): Row {
  return { _row: next++, ...data };
}
