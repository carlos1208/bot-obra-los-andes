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

/** Letra de la columna: 0 → A, 26 → AA. */
export const columnLetter = (c: number): string =>
  (c < 26 ? "" : columnLetter(Math.floor(c / 26) - 1)) + String.fromCharCode(65 + (c % 26));

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

/** Encabezados (fila 1) de una pestaña, leídos en este momento. */
export async function readHeaders(tab: string): Promise<string[]> {
  const data = await sheetsFetch<{ values?: unknown[][] }>(`/values/${encodeURIComponent(`'${tab}'!1:1`)}`);
  return (data.values?.[0] ?? []).map((v) => String(v ?? "").trim());
}

function columnIndex(tab: string, headers: string[], column: string): number {
  const c = headers.indexOf(column);
  if (c < 0) throw new Error(`${tab}: no hay columna ${column}`);
  return c;
}

/** Agrega una fila al final de la pestaña (append + USER_ENTERED), en el orden de sus encabezados. */
export async function appendRow(tab: string, values: Record<string, unknown>): Promise<void> {
  const headers = await readHeaders(tab);
  for (const column of Object.keys(values)) columnIndex(tab, headers, column);
  const row = headers.map((h) => toCell(h, values[h]));
  // Sin INSERT_ROWS: insertar filas copia el formato de la fila de arriba (en una pestaña vacía, el del
  // encabezado). Así la fila nueva usa el formato de la columna (fechas, pesos).
  const q = new URLSearchParams({ valueInputOption: "USER_ENTERED" });
  await sheetsFetch(`/values/${encodeURIComponent(`'${tab}'!A1`)}:append?${q}`, {
    method: "POST",
    body: JSON.stringify({ values: [row] }),
  });
}

/** Cambia celdas de filas ya leídas, p. ej. [{ row: 5, values: { estado: "terminada" } }]. */
export async function updateCells(
  tab: string,
  changes: { row: number; values: Record<string, unknown> }[],
): Promise<void> {
  if (!changes.length) return;
  const headers = await readHeaders(tab);
  const data = changes.flatMap(({ row, values }) =>
    Object.entries(values).map(([column, value]) => ({
      range: `'${tab}'!${columnLetter(columnIndex(tab, headers, column))}${row}`,
      values: [[toCell(column, value)]],
    }))
  );
  await sheetsFetch("/values:batchUpdate", {
    method: "POST",
    body: JSON.stringify({ valueInputOption: "USER_ENTERED", data }),
  });
}
