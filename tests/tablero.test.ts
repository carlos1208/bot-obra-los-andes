// Tablero: códigos de los dos enlaces, vista sin dinero del hermano, datos del avance, fotos con enlace firmado,
// HTML bien formado (HtmlService del Apps Script lo exige) y /tablero por privado.
import { assert, assertEquals, assertFalse, assertStringIncludes } from "jsr:@std/assert@1.0.19";
import { XMLValidator } from "npm:fast-xml-parser@4.5.1";
import {
  BROTHER,
  CARLOS,
  clearSent,
  clock,
  drive,
  GROUP,
  lastText,
  lastTo,
  message,
  processUpdate,
  REPORTS_TOPIC,
  resetSheet,
  rowsOf,
  sheet,
} from "./_world.ts";
import { handler } from "../supabase/functions/tablero/handler.ts";
import { buildDashboard } from "../supabase/functions/tablero/data.ts";

const CARLOS_CODE = "codigo-de-carlos-0123456789";
const BROTHER_CODE = "codigo-del-hermano-0123456789";
Deno.env.set("TABLERO_TOKEN_CARLOS", CARLOS_CODE);
Deno.env.set("TABLERO_TOKEN_HERMANO", BROTHER_CODE);
Deno.env.set("TABLERO_URL", "https://script.google.com/macros/s/tablero/exec");

const on = (iso: string) => (clock.now = () => new Date(`${iso}T12:00:00-05:00`));
const post = (t: unknown) =>
  handler(new Request("https://proyecto.supabase.co/tablero", { method: "POST", body: JSON.stringify({ t }) }));
async function page(code: string): Promise<string> {
  const r = await post(code);
  assertEquals(r.status, 200);
  return await r.text();
}

function addRow(tab: string, values: Record<string, unknown>) {
  const headers = sheet[tab][0] as string[];
  sheet[tab].push(headers.map((h) => values[h] ?? ""));
}
function setConfig(key: string, value: string) {
  const i = rowsOf("Config").findIndex((r) => r.clave === key);
  sheet.Config[i + 1][1] = value;
}

/** Un par F01 en Drive: ANTES y DESPUÉS por validar, y un PDF que no es foto. */
function addPair() {
  drive.length = 0;
  const props = { codigo: "F01", nombre: "Muro cocina–sala completo", estado: "por validar", subido_por: "Carlos" };
  drive.push(
    {
      id: "carpeta1",
      name: "F01 Muro cocina–sala completo",
      mimeType: "application/vnd.google-apps.folder",
      parents: ["raiz"],
    },
    {
      id: "antes1",
      name: "ANTES 2026-10-24 (1).jpg",
      mimeType: "image/jpeg",
      parents: ["carpeta1"],
      appProperties: { tipo: "antes", ...props },
    },
    {
      id: "despues1",
      name: "DESPUÉS 2026-10-27 (1).jpg",
      mimeType: "image/jpeg",
      parents: ["carpeta1"],
      appProperties: { tipo: "después", estado: "por validar" },
    },
    { id: "factura1", name: "Factura.pdf", mimeType: "application/pdf", parents: ["raiz"] },
  );
}

/** HtmlService rechaza HTML mal formado: sin el script ni los estilos, la página debe leerse como XML. */
function assertWellFormed(html: string) {
  const body = html
    .replace("<!DOCTYPE html>", "")
    .replace(/<style>[\s\S]*?<\/style>/, "")
    .replace(/<script>[\s\S]*?<\/script>/, "");
  const result = XMLValidator.validate(body);
  assert(result === true, JSON.stringify(result));
}

Deno.test("sin código o con uno que no es, no muestra nada", async () => {
  await resetSheet();
  for (const t of [undefined, "", "otro", CARLOS_CODE.slice(0, -1)]) {
    const r = await post(t);
    assertEquals(r.status, 401);
    assertStringIncludes(await r.text(), "Pídele uno nuevo al bot con /tablero");
  }
  assertEquals(await (await handler(new Request("https://proyecto.supabase.co/tablero"))).text(), "ok");
});

Deno.test("Carlos ve todo; el hermano, sin dinero (salvo hermano_ve_dinero = sí)", async () => {
  await resetSheet();
  addPair();
  on("2026-10-28");
  const full = await page(CARLOS_CODE);
  assertWellFormed(full);
  for (
    const text of [
      "Vista completa",
      "mié 28 oct · Semana 1 de obra",
      '<section id="dinero">',
      "Disponible de los 12 M",
      "Presupuesto y gastado por capítulo",
      "<small>a pagar · sin pagar</small>",
      '<section id="compras">',
      "Caja menor",
      '<section id="fotos">',
    ]
  ) assertStringIncludes(full, text);

  const brother = await page(BROTHER_CODE);
  assertWellFormed(brother);
  assertStringIncludes(brother, "Vista sin dinero");
  for (const text of ['id="dinero"', "Disponible de los 12 M", "a pagar", "Albañil (saldo de los 5 hitos)"]) {
    assertFalse(brother.includes(text), text);
  }
  // Compras y caja menor sí, como en las preguntas del bot.
  assertStringIncludes(brother, '<section id="compras">');
  assertStringIncludes(brother, "Caja menor");

  setConfig("hermano_ve_dinero", "sí");
  assertStringIncludes(await page(BROTHER_CODE), "Disponible de los 12 M");
  await resetSheet();
});

Deno.test("avance: curva con el reporte y hoy, semanas, atrasados y hitos", async () => {
  await resetSheet();
  drive.length = 0;
  on("2026-10-28");
  addRow("Reportes", { fecha: "2026-10-27", hora: "17:10", reportado_por: "Hermano", avance_obra_pct: 4 });
  const d = await buildDashboard("carlos", (id) => Promise.resolve(id));

  assertEquals([d.start, d.end, d.week], ["2026-10-26", "2026-12-23", 1]);
  const point = (date: string) => d.progress.curve.find((p) => p.date === date)!;
  assertEquals(point("2026-10-26").actual, undefined); // ese día no hubo reporte
  assertEquals(point("2026-10-27").actual, 4);
  assertEquals(point("2026-10-28").actual, d.progress.actual); // hoy: la hoja en este momento
  assertEquals(point("2026-10-29").actual, undefined);
  assert(point("2026-10-28").expected > point("2026-10-26").expected);
  assertEquals(d.progress.curve.at(-1)!.expected, 100);

  // 9 semanas (26 oct – 21 dic); la actual va abierta, con las tareas de la semana y el festivo del 2 nov.
  assertEquals(d.weeks.length, 9);
  assertEquals(d.weeks.filter((w) => w.current).map((w) => w.number), [1]);
  assertEquals(d.weeks[0].tasks.find((t) => t.id === "02")!.days, [true, true, false, false, false, false]);
  assertEquals(d.weeks[1].off, [true, false, false, false, false, false]);

  // Atrasados: tareas cuyo fin pasó y lo esperado sin confirmar.
  assertEquals(d.lateTasks.map((t) => [t.id, t.days]), [["01", 2], ["02", 1]]);
  assertEquals(d.weeks[0].tasks.find((t) => t.id === "02")!.state, "atrasada");
  assertEquals(d.lateExpected.map((e) => [e.date, e.what]), [
    ["2026-10-26", "El albañil empieza la obra"],
    ["2026-10-28", "Viga instalada y puntales retirados"],
  ]);
  assertEquals(d.milestones[0].hito, "H1");
  assertEquals(d.milestones[0].toPay, 700000);

  const brother = await buildDashboard("hermano", (id) => Promise.resolve(id));
  assertEquals(brother.moneyView, undefined);
  assertEquals("toPay" in brother.milestones[0], false);
  await resetSheet();
});

Deno.test("compras: por semana, por capítulo y productos con buscador", async () => {
  await resetSheet();
  drive.length = 0;
  on("2026-10-28");
  addRow("Gastos", {
    fecha: "2026-10-27",
    proveedor: "Ferretería",
    items: "Anticorrosivo",
    capitulo: "Materiales de obra y pintura",
    valor: 45000,
    medio_pago: "Caja menor",
    cuenta_12M: "sí",
    enlace_factura: "https://drive/f1",
  });
  const d = await buildDashboard("carlos", (id) => Promise.resolve(id));
  const p = d.purchases;
  assertEquals(p.byWeek, [{ week: 1, monday: "2026-10-26", total: 45000 }]);
  assertEquals(p.beforeStart, 1834030 + 2703886 + 215700 + 19900);
  assertEquals(p.latest[0].supplier, "Ferretería");
  assertEquals(p.latest[0].link, "https://drive/f1");
  assertEquals(p.pettyCash, { fund: 100000, balance: 55000, toRefill: 45000 });
  assertEquals(p.products.length, 38);
  const chapter = d.moneyView!.chapters.find((c) => c.name === "Materiales de obra y pintura")!;
  assertEquals(chapter.spent, 45000);
  assertEquals(d.moneyView!.outside12M, 1834030 + 2703886 + 215700 + 19900 + 100000 + 100000 + 1300000);

  // El hermano no ve los enlaces de Drive.
  const brother = await buildDashboard("hermano", (id) => Promise.resolve(id));
  assertEquals(brother.purchases.latest[0].link, undefined);

  const html = await page(CARLOS_CODE);
  assertStringIncludes(html, '<input id="buscar" type="search"');
  assertStringIncludes(html, 'data-q="lavamanos ovalado blanco lavamanos oval bla easy');
  assertStringIncludes(html, "38 productos");
  await resetSheet();
});

Deno.test("fotos: enlace firmado por quien mira, solo fotos y con vencimiento", async () => {
  await resetSheet();
  addPair();
  on("2026-10-28");
  const html = await page(BROTHER_CODE);
  assertStringIncludes(html, "<b>F01</b> Muro cocina–sala completo");
  assertStringIncludes(html, "por validar");
  const urls = [...html.matchAll(/<img src="([^"]+)"/g)].map((m) => m[1].replaceAll("&amp;", "&"));
  assertEquals(urls.length, 2);
  assert(urls[0].startsWith("https://proyecto.supabase.co/functions/v1/tablero?foto=antes1&"));
  assertFalse(html.includes(BROTHER_CODE));
  // 12 fotos del catálogo siguen sin ANTES.
  assertStringIncludes(html, "12 fotos del catálogo sin ANTES");

  const get = (url: string) => handler(new Request(url.replace("/functions/v1", "")));
  const ok = await get(urls[0]);
  assertEquals([ok.status, ok.headers.get("Content-Type")], [200, "image/jpeg"]);
  assertEquals([...new Uint8Array(await ok.arrayBuffer())], [4, 5, 6]);

  // Otra foto con la misma firma, firma cambiada o de otro código: no.
  for (
    const bad of [
      urls[0].replace("foto=antes1", "foto=despues1"),
      urls[0].replace(/firma=\w/, "firma=0"),
      urls[0].replace("v=h", "v=c"),
    ]
  ) {
    assertEquals((await get(bad)).status, 403, bad);
  }
  // Vence en dos o tres días.
  on("2026-10-31");
  assertEquals((await get(urls[0])).status, 403);
  // Cambiar el código del hermano invalida sus enlaces.
  on("2026-10-28");
  Deno.env.set("TABLERO_TOKEN_HERMANO", "otro-codigo-del-hermano-0123456789");
  assertEquals((await get(urls[0])).status, 403);
  Deno.env.set("TABLERO_TOKEN_HERMANO", BROTHER_CODE);
  drive.length = 0;
});

Deno.test("si la hoja falla, avisa a Carlos y no muestra nada", async () => {
  await resetSheet();
  sheet.Config = [["clave", "valor", "nota"]];
  clearSent();
  const r = await post(CARLOS_CODE);
  assertEquals(r.status, 500);
  assertStringIncludes(lastTo(CARLOS), "Error (tablero)");
  await resetSheet();
});

Deno.test("/tablero: cada uno recibe su enlace por privado", async () => {
  await resetSheet();
  clearSent();
  await processUpdate(message(CARLOS, { text: "/tablero" }));
  assertStringIncludes(lastText(), `href="https://script.google.com/macros/s/tablero/exec?t=${CARLOS_CODE}"`);
  await processUpdate(message(BROTHER, { text: "/tablero" }));
  assertStringIncludes(lastText(), `?t=${BROTHER_CODE}"`);
  await processUpdate(message(BROTHER, { text: "/tablero" }, GROUP, REPORTS_TOPIC));
  assertStringIncludes(lastText(), "pídemelo por privado");
  assertFalse(lastText().includes(BROTHER_CODE));
});
