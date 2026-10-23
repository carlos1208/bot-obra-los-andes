// Carga las pestañas de la hoja desde semillas/*.csv.
// No toca una pestaña que ya tenga datos, salvo que la pidas con --reemplazar.
//
// Uso:
//   deno task crear-hoja                          crea y llena las pestañas que falten
//   deno task crear-hoja --reemplazar Tareas,Objetivos
//   deno task crear-hoja --reemplazar todas       (borra Reportes, Gastos y Pagos: cuidado)
import { parse } from "jsr:@std/csv@1.0.6";
import { cargarEnv, requerido } from "./_env.ts";
import { prepararCelda, sheetsFetch } from "../supabase/functions/_shared/sheets.ts";

await cargarEnv();
for (const n of ["SHEET_ID", "GOOGLE_SA_EMAIL", "GOOGLE_SA_PRIVATE_KEY"]) requerido(n);

const PESTANAS = ["Tareas", "Hitos", "Esperado", "Objetivos", "Reportes", "Gastos", "Pagos", "Presupuesto", "Config"];
const MONEDA = new Set(["valor", "descuento", "valor_a_pagar", "total", "asignado", "gastado", "saldo", "caja_menor"]);
const FECHAS = new Set(["fecha", "inicio", "fin", "fecha_prevista", "fecha_cumplido", "fecha_pago"]);
const CONFIG_MONEDA = new Set([
  "presupuesto_disponible",
  "total_albanil",
  "reserva_albanil",
  "fondo_caja_menor",
  "tope_compra_caja_menor",
  "compra_sin_factura_max",
]);

const i = Deno.args.indexOf("--reemplazar");
const pedidas = i >= 0 ? (Deno.args[i + 1] ?? "").split(",").map((s) => s.trim()) : [];
const reemplazar = new Set(pedidas.includes("todas") ? PESTANAS : pedidas);
for (const p of reemplazar) {
  if (!PESTANAS.includes(p)) {
    console.error(`No conozco la pestaña «${p}». Opciones: ${PESTANAS.join(", ")} o «todas».`);
    Deno.exit(1);
  }
}

const letra = (c: number): string => (c < 26 ? "" : letra(Math.floor(c / 26) - 1)) + String.fromCharCode(65 + (c % 26));

async function leerCsv(nombre: string): Promise<string[][]> {
  return parse(await Deno.readTextFile(`semillas/${nombre}.csv`));
}

interface Hoja {
  properties: { sheetId: number; title: string };
}

const info = await sheetsFetch<{ sheets: Hoja[]; properties: { title: string } }>(
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

const existentes = new Map(info.sheets.map((s) => [s.properties.title, s.properties.sheetId]));
const faltan = PESTANAS.filter((p) => !existentes.has(p));
if (faltan.length) {
  const r = await sheetsFetch<{ replies: { addSheet: Hoja }[] }>(":batchUpdate", {
    method: "POST",
    body: JSON.stringify({ requests: faltan.map((title) => ({ addSheet: { properties: { title } } })) }),
  });
  for (const rep of r.replies) existentes.set(rep.addSheet.properties.title, rep.addSheet.properties.sheetId);
}

// ¿Qué pestañas ya tienen datos?
const q = new URLSearchParams();
for (const p of PESTANAS) q.append("ranges", `'${p}'!A1:Z3`);
const muestra = await sheetsFetch<{ valueRanges: { values?: unknown[][] }[] }>(`/values:batchGet?${q}`);
const conDatos = new Set(PESTANAS.filter((_, k) => (muestra.valueRanges[k].values?.length ?? 0) > 1));

// Encabezados de Gastos y Pagos para las fórmulas de Presupuesto.
const encabezados: Record<string, string[]> = {};
for (const p of PESTANAS) encabezados[p] = (await leerCsv(p))[0];
const col = (pestana: string, nombre: string) => {
  const c = encabezados[pestana].indexOf(nombre);
  if (c < 0) throw new Error(`${pestana} no tiene la columna ${nombre}`);
  return letra(c);
};

function valoresDe(pestana: string, filas: string[][]): (string | number | boolean)[][] {
  let cabecera = [...filas[0]];
  let datos = filas.slice(1).map((f) => [...f]);

  if (pestana === "Presupuesto") {
    // Se agregan gastado y saldo después de asignado.
    const pos = cabecera.indexOf("asignado") + 1;
    cabecera.splice(pos, 0, "gastado", "saldo");
    const cap = letra(cabecera.indexOf("capitulo"));
    const asig = letra(cabecera.indexOf("asignado"));
    const gast = letra(pos);
    datos = datos.map((f, k) => {
      const r = k + 2;
      const sumas = [
        ["Gastos", "total"],
        ["Pagos", "valor"],
      ].flatMap(([p, v]) =>
        ["sí", "si"].map((s) =>
          `SUMIFS(${p}!${col(p, v)}:${col(p, v)},${p}!${col(p, "capitulo")}:${col(p, "capitulo")},$${cap}${r},` +
          `${p}!${col(p, "cuenta_12M")}:${col(p, "cuenta_12M")},"${s}")`
        )
      );
      f.splice(pos, 0, `=${sumas.join("+")}`, `=IF(${asig}${r}="","",${asig}${r}-${gast}${r})`);
      return f;
    });
  }
  if (pestana === "Hitos") {
    const v = letra(cabecera.indexOf("valor"));
    const d = letra(cabecera.indexOf("descuento"));
    const c = cabecera.indexOf("valor_a_pagar");
    datos.forEach((f, k) => (f[c] = `=IF(${v}${k + 2}="","",${v}${k + 2}-N(${d}${k + 2}))`));
  }
  cabecera = cabecera.map((h) => h.trim());
  return [cabecera, ...datos.map((f) => f.map((v, c) => prepararCelda(cabecera[c], v)))];
}

const escribir: { range: string; values: unknown[][] }[] = [];
const limpiar: string[] = [];
const formato: unknown[] = [];

for (const p of PESTANAS) {
  if (conDatos.has(p) && !reemplazar.has(p)) {
    console.log(`  = ${p}: ya tiene datos, no la toco`);
    continue;
  }
  const valores = valoresDe(p, await leerCsv(p));
  limpiar.push(`'${p}'`);
  escribir.push({ range: `'${p}'!A1`, values: valores });
  const sheetId = existentes.get(p)!;
  const cabecera = valores[0] as string[];
  formato.push(
    {
      updateSheetProperties: {
        properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
        fields: "gridProperties.frozenRowCount",
      },
    },
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
        cell: {
          userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.91, green: 0.94, blue: 0.98 } },
        },
        fields: "userEnteredFormat(textFormat,backgroundColor)",
      },
    },
  );
  cabecera.forEach((h, c) => {
    const tipo = MONEDA.has(h)
      ? { type: "CURRENCY", pattern: '"$"#,##0' }
      : FECHAS.has(h)
      ? { type: "DATE", pattern: "ddd d mmm" }
      : null;
    if (!tipo || p === "Config") return;
    formato.push({
      repeatCell: {
        range: { sheetId, startRowIndex: 1, startColumnIndex: c, endColumnIndex: c + 1 },
        cell: { userEnteredFormat: { numberFormat: tipo } },
        fields: "userEnteredFormat.numberFormat",
      },
    });
  });
  if (p === "Config") {
    const cv = cabecera.indexOf("valor");
    valores.slice(1).forEach((f, k) => {
      if (!CONFIG_MONEDA.has(String(f[0]))) return;
      formato.push({
        repeatCell: {
          range: { sheetId, startRowIndex: k + 1, endRowIndex: k + 2, startColumnIndex: cv, endColumnIndex: cv + 1 },
          cell: { userEnteredFormat: { numberFormat: { type: "CURRENCY", pattern: '"$"#,##0' } } },
          fields: "userEnteredFormat.numberFormat",
        },
      });
    });
  }
  formato.push({
    autoResizeDimensions: { dimensions: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: cabecera.length } },
  });
  console.log(`  + ${p}: ${valores.length - 1} filas`);
}

if (limpiar.length) {
  await sheetsFetch("/values:batchClear", { method: "POST", body: JSON.stringify({ ranges: limpiar }) });
  await sheetsFetch("/values:batchUpdate", {
    method: "POST",
    body: JSON.stringify({ valueInputOption: "USER_ENTERED", data: escribir }),
  });
}

// La pestaña vacía que trae una hoja nueva («Sheet1» / «Hoja 1») sobra.
const sobrantes = [...existentes].filter(([t]) => !PESTANAS.includes(t) && /^(sheet|hoja)\s?1$/i.test(t));
for (const [titulo, sheetId] of sobrantes) {
  formato.push({ deleteSheet: { sheetId } });
  console.log(`  - ${titulo}: borrada`);
}

formato.push({
  updateSpreadsheetProperties: {
    properties: { locale: "es_CO", timeZone: "America/Bogota" },
    fields: "locale,timeZone",
  },
});
await sheetsFetch(":batchUpdate", { method: "POST", body: JSON.stringify({ requests: formato }) });

console.log(`\nListo: https://docs.google.com/spreadsheets/d/${Deno.env.get("SHEET_ID")}/edit`);
