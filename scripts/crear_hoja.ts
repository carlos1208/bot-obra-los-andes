// Carga las pestañas de la hoja desde semillas/*.csv.
// No toca los datos de una pestaña que ya los tenga, salvo que la pidas con --reemplazar. Si la semilla trae
// columnas nuevas, las agrega al final del encabezado.
//
// Uso:
//   deno task crear-hoja                          crea y llena las pestañas que falten
//   deno task crear-hoja --reemplazar Tareas,Objetivos
//   deno task crear-hoja --reemplazar todas       (borra Reportes, Gastos, Productos y Pagos: cuidado)
import { parse } from "jsr:@std/csv@1.0.6";
import { loadEnv, required } from "./_env.ts";
import { columnLetter, sheetsFetch, toCell } from "../supabase/functions/_shared/sheets.ts";

await loadEnv();
for (const n of ["SHEET_ID", "GOOGLE_SA_EMAIL", "GOOGLE_SA_PRIVATE_KEY"]) required(n);

const TABS = [
  "Tareas",
  "Hitos",
  "Esperado",
  "Objetivos",
  "Reportes",
  "Notas",
  "Gastos",
  "Productos",
  "Pagos",
  "Presupuesto",
  "Config",
];
const MONEY_COLUMNS = new Set([
  "valor",
  "descuento",
  "valor_a_pagar",
  "presupuestado",
  "gastado",
  "saldo",
  "saldo_caja_menor",
  "valor_unitario",
  "valor_total",
]);
const DATE_COLUMNS = new Set([
  "fecha",
  "inicio",
  "fin",
  "inicio_semana",
  "fecha_estimada",
  "fecha_cumplido",
  "fecha_pago",
  "registrado_el",
]);
const MONEY_CONFIG_KEYS = new Set([
  "presupuesto_disponible",
  "total_albanil",
  "reserva_albanil",
  "fondo_caja_menor",
  "tope_compra_caja_menor",
  "compra_sin_factura_max",
]);
const MONEY_FORMAT = { type: "CURRENCY", pattern: '"$"#,##0' };
const DATE_FORMAT = { type: "DATE", pattern: "ddd d mmm" };

const flag = Deno.args.indexOf("--reemplazar");
const requested = flag >= 0 ? (Deno.args[flag + 1] ?? "").split(",").map((s) => s.trim()) : [];
const replace = new Set(requested.includes("todas") ? TABS : requested);
for (const t of replace) {
  if (!TABS.includes(t)) {
    console.error(`No conozco la pestaña «${t}». Opciones: ${TABS.join(", ")} o «todas».`);
    Deno.exit(1);
  }
}

async function readCsv(tab: string): Promise<string[][]> {
  return parse(await Deno.readTextFile(`semillas/${tab}.csv`));
}

interface SheetInfo {
  properties: { sheetId: number; title: string };
}

const info = await sheetsFetch<{ sheets: SheetInfo[]; properties: { title: string } }>(
  "?fields=properties.title,sheets.properties(sheetId,title)",
);
console.log(`Hoja: ${info.properties.title}`);

// Fórmulas en sintaxis en_US mientras se escribe; al final se pasa a es_CO.
await sheetsFetch(":batchUpdate", {
  method: "POST",
  body: JSON.stringify({
    requests: [{ updateSpreadsheetProperties: { properties: { locale: "en_US" }, fields: "locale" } }],
  }),
});

const sheetIds = new Map(info.sheets.map((s) => [s.properties.title, s.properties.sheetId]));
const missing = TABS.filter((t) => !sheetIds.has(t));
if (missing.length) {
  const r = await sheetsFetch<{ replies: { addSheet: SheetInfo }[] }>(":batchUpdate", {
    method: "POST",
    body: JSON.stringify({ requests: missing.map((title) => ({ addSheet: { properties: { title } } })) }),
  });
  for (const rep of r.replies) sheetIds.set(rep.addSheet.properties.title, rep.addSheet.properties.sheetId);
}

// ¿Qué pestañas ya tienen datos?
const q = new URLSearchParams();
for (const t of TABS) q.append("ranges", `'${t}'!A1:Z3`);
const sample = await sheetsFetch<{ valueRanges: { values?: unknown[][] }[] }>(`/values:batchGet?${q}`);
const withData = new Set(TABS.filter((_, k) => (sample.valueRanges[k].values?.length ?? 0) > 1));

// Encabezados de Gastos y Pagos para las fórmulas de Presupuesto.
const headersByTab: Record<string, string[]> = {};
for (const t of TABS) headersByTab[t] = (await readCsv(t))[0];
const col = (tab: string, column: string) => {
  const c = headersByTab[tab].indexOf(column);
  if (c < 0) throw new Error(`${tab} no tiene la columna ${column}`);
  return columnLetter(c);
};

function tabValues(tab: string, csv: string[][]): (string | number | boolean)[][] {
  let headers = [...csv[0]];
  let rows = csv.slice(1).map((r) => [...r]);

  if (tab === "Presupuesto") {
    // Se agregan gastado y saldo después de presupuestado.
    const pos = headers.indexOf("presupuestado") + 1;
    headers.splice(pos, 0, "gastado", "saldo");
    const chapter = columnLetter(headers.indexOf("capitulo"));
    const budget = columnLetter(headers.indexOf("presupuestado"));
    const spent = columnLetter(pos);
    rows = rows.map((r, k) => {
      const n = k + 2;
      const sums = [
        ["Gastos", "valor"],
        ["Pagos", "valor"],
      ].flatMap(([t, v]) =>
        ["sí", "si"].map((yes) =>
          `SUMIFS(${t}!${col(t, v)}:${col(t, v)},${t}!${col(t, "capitulo")}:${col(t, "capitulo")},$${chapter}${n},` +
          `${t}!${col(t, "cuenta_12M")}:${col(t, "cuenta_12M")},"${yes}")`
        )
      );
      r.splice(pos, 0, `=${sums.join("+")}`, `=IF(${budget}${n}="","",${budget}${n}-${spent}${n})`);
      return r;
    });
  }
  if (tab === "Hitos") {
    const value = columnLetter(headers.indexOf("valor"));
    const discount = columnLetter(headers.indexOf("descuento"));
    const c = headers.indexOf("valor_a_pagar");
    rows.forEach((r, k) => (r[c] = `=IF(${value}${k + 2}="","",${value}${k + 2}-N(${discount}${k + 2}))`));
  }
  headers = headers.map((h) => h.trim());
  return [headers, ...rows.map((r) => r.map((v, c) => toCell(headers[c], v)))];
}

const writes: { range: string; values: unknown[][] }[] = [];
const clears: string[] = [];
const requests: unknown[] = [];

const headerFormat = (sheetId: number, from?: number, to?: number) => ({
  repeatCell: {
    range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: from, endColumnIndex: to },
    cell: {
      userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.91, green: 0.94, blue: 0.98 } },
    },
    fields: "userEnteredFormat(textFormat,backgroundColor)",
  },
});

/** Formato de pesos o de fecha de la columna, según su nombre. */
function columnFormat(tab: string, sheetId: number, header: string, c: number) {
  const format = MONEY_COLUMNS.has(header) ? MONEY_FORMAT : DATE_COLUMNS.has(header) ? DATE_FORMAT : null;
  if (!format || tab === "Config") return [];
  return [{
    repeatCell: {
      range: { sheetId, startRowIndex: 1, startColumnIndex: c, endColumnIndex: c + 1 },
      cell: { userEnteredFormat: { numberFormat: format } },
      fields: "userEnteredFormat.numberFormat",
    },
  }];
}

for (const t of TABS) {
  if (withData.has(t) && !replace.has(t)) {
    // Columnas nuevas de la semilla: al final del encabezado, sin tocar los datos.
    const current = (sample.valueRanges[TABS.indexOf(t)].values?.[0] ?? []).map((v) => String(v ?? "").trim());
    const added = (tabValues(t, await readCsv(t))[0] as string[]).filter((h) => !current.includes(h));
    if (!added.length) {
      console.log(`  = ${t}: ya tiene datos, no la toco`);
      continue;
    }
    const sheetId = sheetIds.get(t)!;
    writes.push({ range: `'${t}'!${columnLetter(current.length)}1`, values: [added] });
    requests.push(headerFormat(sheetId, current.length, current.length + added.length));
    added.forEach((h, i) => requests.push(...columnFormat(t, sheetId, h, current.length + i)));
    console.log(`  + ${t}: columnas nuevas ${added.join(", ")} (los datos no se tocan)`);
    continue;
  }
  const values = tabValues(t, await readCsv(t));
  clears.push(`'${t}'`);
  writes.push({ range: `'${t}'!A1`, values });
  const sheetId = sheetIds.get(t)!;
  const headers = values[0] as string[];
  requests.push(
    {
      updateSheetProperties: {
        properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
        fields: "gridProperties.frozenRowCount",
      },
    },
    headerFormat(sheetId),
    // Borra el formato que quedó debajo del encabezado (p. ej. filas que copiaron el del encabezado).
    { repeatCell: { range: { sheetId, startRowIndex: 1 }, cell: {}, fields: "userEnteredFormat" } },
  );
  headers.forEach((h, c) => requests.push(...columnFormat(t, sheetId, h, c)));
  if (t === "Config") {
    const vc = headers.indexOf("valor");
    values.slice(1).forEach((r, k) => {
      if (!MONEY_CONFIG_KEYS.has(String(r[0]))) return;
      requests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: k + 1, endRowIndex: k + 2, startColumnIndex: vc, endColumnIndex: vc + 1 },
          cell: { userEnteredFormat: { numberFormat: MONEY_FORMAT } },
          fields: "userEnteredFormat.numberFormat",
        },
      });
    });
  }
  requests.push({
    autoResizeDimensions: { dimensions: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: headers.length } },
  });
  console.log(`  + ${t}: ${values.length - 1} filas`);
}

if (clears.length) {
  await sheetsFetch("/values:batchClear", { method: "POST", body: JSON.stringify({ ranges: clears }) });
}
if (writes.length) {
  await sheetsFetch("/values:batchUpdate", {
    method: "POST",
    body: JSON.stringify({ valueInputOption: "USER_ENTERED", data: writes }),
  });
}

// La pestaña vacía que trae una hoja nueva («Sheet1» / «Hoja 1») sobra.
const leftovers = [...sheetIds].filter(([title]) => !TABS.includes(title) && /^(sheet|hoja)\s?1$/i.test(title));
for (const [title, sheetId] of leftovers) {
  requests.push({ deleteSheet: { sheetId } });
  console.log(`  - ${title}: borrada`);
}

requests.push({
  updateSpreadsheetProperties: {
    properties: { locale: "es_CO", timeZone: "America/Bogota" },
    fields: "locale,timeZone",
  },
});
await sheetsFetch(":batchUpdate", { method: "POST", body: JSON.stringify({ requests }) });

console.log(`\nListo: https://docs.google.com/spreadsheets/d/${Deno.env.get("SHEET_ID")}/edit`);
