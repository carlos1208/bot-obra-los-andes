// Cliente mínimo de Google Sheets API v4. Cada llamada lee la hoja en ese momento.

import { env } from "./env.ts";
import { serviceAccountToken } from "./google_auth.ts";
import type { Row } from "./site.ts";

const BASE = "https://sheets.googleapis.com/v4/spreadsheets";

export async function sheetsFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
  sheetId = env("SHEET_ID"),
): Promise<T> {
  const r = await fetch(`${BASE}/${sheetId}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${await serviceAccountToken()}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`Sheets ${r.status}: ${data.error?.message ?? r.statusText}`);
  return data as T;
}

/** Convierte una matriz con encabezados en filas con nombre de columna y número de fila. */
export function toRows(values: unknown[][]): Row[] {
  if (!values.length) return [];
  const headers = values[0].map((v) => String(v ?? "").trim());
  return values.slice(1).map((cells, i) => {
    const row: Row = { _row: i + 2 };
    headers.forEach((column, j) => {
      if (column) row[column] = cells[j] ?? "";
    });
    return row;
  }).filter((r) => Object.entries(r).some(([k, v]) => k !== "_row" && v !== ""));
}

/**
 * Lee varias pestañas completas en una sola llamada.
 * Fechas como serial y números sin formato, para no depender del idioma de la hoja.
 */
export async function readTabs<N extends string>(names: N[]): Promise<Record<N, Row[]>> {
  const q = new URLSearchParams({
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "SERIAL_NUMBER",
  });
  for (const n of names) q.append("ranges", `'${n}'`);
  const data = await sheetsFetch<{ valueRanges: { values?: unknown[][] }[] }>(`/values:batchGet?${q}`);
  const result = {} as Record<N, Row[]>;
  names.forEach((n, i) => {
    result[n] = toRows(data.valueRanges[i]?.values ?? []);
  });
  return result;
}

// Columnas que siempre son texto aunque parezcan números («02», «10,16», «5209100261757»).
const TEXT_COLUMNS = new Set([
  "id",
  "tarea_id",
  "depende_de",
  "hito",
  "numero",
  "numero_factura",
  "nit",
  "tareas_terminadas",
  "tareas_avanzadas",
]);

/** Prepara un valor para escribirlo con valueInputOption=USER_ENTERED. */
export function toCell(column: string, value: unknown): string | number | boolean {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean") return value;
  const s = String(value);
  if (s === "" || s.startsWith("=")) return s;
  if (TEXT_COLUMNS.has(column) || /^\d{1,2}:\d{2}$/.test(s) || /^0\d/.test(s)) return `'${s}`;
  return s;
}
