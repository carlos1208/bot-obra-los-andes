// Cliente mínimo de Google Sheets API v4. Cada llamada lee la hoja en ese momento.

import { env } from "./env.ts";
import { tokenCuentaServicio } from "./google_auth.ts";
import type { Fila } from "./obra.ts";

const BASE = "https://sheets.googleapis.com/v4/spreadsheets";

export async function sheetsFetch<T = unknown>(
  ruta: string,
  init: RequestInit = {},
  sheetId = env("SHEET_ID"),
): Promise<T> {
  const r = await fetch(`${BASE}/${sheetId}${ruta}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${await tokenCuentaServicio()}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const datos = await r.json();
  if (!r.ok) throw new Error(`Sheets ${r.status}: ${datos.error?.message ?? r.statusText}`);
  return datos as T;
}

/** Convierte una matriz con encabezados en filas con nombre de columna y número de fila. */
export function filasAObjetos(valores: unknown[][]): Fila[] {
  if (!valores.length) return [];
  const encabezados = valores[0].map((v) => String(v ?? "").trim());
  return valores.slice(1).map((fila, i) => {
    const obj: Fila = { _fila: i + 2 };
    encabezados.forEach((col, j) => {
      if (col) obj[col] = fila[j] ?? "";
    });
    return obj;
  }).filter((f) => Object.entries(f).some(([k, v]) => k !== "_fila" && v !== ""));
}

/**
 * Lee varias pestañas completas en una sola llamada.
 * Fechas como serial y números sin formato, para no depender del idioma de la hoja.
 */
export async function leerPestanas<N extends string>(nombres: N[]): Promise<Record<N, Fila[]>> {
  const q = new URLSearchParams({
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "SERIAL_NUMBER",
  });
  for (const n of nombres) q.append("ranges", `'${n}'`);
  const datos = await sheetsFetch<{ valueRanges: { values?: unknown[][] }[] }>(`/values:batchGet?${q}`);
  const salida = {} as Record<N, Fila[]>;
  nombres.forEach((n, i) => {
    salida[n] = filasAObjetos(datos.valueRanges[i]?.values ?? []);
  });
  return salida;
}

// Columnas que siempre son texto aunque parezcan números («02», «08,24», «H1»).
const COLUMNAS_TEXTO = new Set([
  "id",
  "tarea",
  "tareas",
  "hito",
  "hitos",
  "numero",
  "nit",
  "se_hizo",
  "terminadas",
  "avanzaron",
]);

/** Prepara un valor para escribirlo con valueInputOption=USER_ENTERED. */
export function prepararCelda(columna: string, valor: unknown): string | number | boolean {
  if (valor === null || valor === undefined) return "";
  if (typeof valor === "number" || typeof valor === "boolean") return valor;
  const s = String(valor);
  if (s === "" || s.startsWith("=")) return s;
  if (COLUMNAS_TEXTO.has(columna) || /^\d{1,2}:\d{2}$/.test(s) || /^0\d/.test(s)) return `'${s}`;
  return s;
}
