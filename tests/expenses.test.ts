// Gastos de punta a punta: factura → vista previa → caja menor o Carlos → guardar; tope; corregir campo;
// compra sin factura (máximo y una por día); PDF por privado; Gemini sin cuota.
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.19";
import {
  BROTHER,
  buttons,
  CARLOS,
  clearSent,
  clock,
  drive,
  EXPENSES_TOPIC,
  gemini,
  GROUP,
  lastText,
  lastTo,
  message,
  pdf,
  photo,
  processUpdate,
  rowsOf,
  sent,
  tables,
  tap,
  timing,
} from "./_world.ts";

clock.now = () => new Date("2026-10-28T15:00:00Z"); // mié 28 oct, 10:00 en Bogotá
timing.retryWaitMs = 0;

const invoice = (over: Record<string, unknown> = {}) => ({
  supplier: "Ferretería El Maestro",
  tax_id: "900.111.222-3",
  date: "2026-10-28",
  number: "FE123",
  items: ["Cemento gris 50 kg"],
  total: 32000,
  chapter: "Materiales de obra y pintura",
  ...over,
});
const inExpenses = (from: number, extra: Record<string, unknown>) => message(from, extra, GROUP, EXPENSES_TOPIC);
const tapExpenses = (from: number, data: string) => tap(from, data, GROUP, EXPENSES_TOPIC);
const lastExpense = () => rowsOf("Gastos").at(-1)!;
const callbackAnswers = () =>
  sent.filter((e) => e.method === "answerCallbackQuery").map((e) => String(e.params.text ?? ""));

Deno.test("factura con caja menor: vista previa, guardar, Drive y saldo", async () => {
  clearSent();
  gemini.replies.push(invoice());
  await processUpdate(inExpenses(BROTHER, photo("f1")));
  assertEquals(sent.find((e) => e.method === "sendMessage")!.params.text, "Leyendo la factura…");
  const preview = lastText();
  assertStringIncludes(preview, "Proveedor: Ferretería El Maestro");
  assertStringIncludes(preview, "Total: $32.000");
  assertStringIncludes(preview, "Pago: elige abajo");
  // Los capítulos salen de Presupuesto.
  const schema = gemini.calls.at(-1)!.body.generationConfig.responseFormat.text.schema;
  assertEquals(schema.properties.chapter.enum.length, 14);
  assertEquals(rowsOf("Gastos").length, 4); // nada escrito todavía

  await processUpdate(tapExpenses(BROTHER, "gas:p:caja"));
  assertStringIncludes(lastText(), "Pago: Caja menor");
  assert(buttons().includes("Sí, guardar|gas:ok"));

  await processUpdate(tapExpenses(BROTHER, "gas:ok"));
  const row = lastExpense();
  assertEquals(row.fecha, "2026-10-28");
  assertEquals(row.numero_factura, "FE123");
  assertEquals(row.valor, 32000);
  assertEquals(row.medio_pago, "caja menor");
  assertEquals(row.cuenta_12M, "sí");
  assertEquals(row.registrado_por, "Hermano");
  const file = drive.find((f) => f.name === "2026-10-28 Ferretería El Maestro FE123 - 32.000.jpg")!;
  assertEquals(file.parents, [drive.find((f) => f.name === "Facturas")!.id]);
  assertEquals(row.enlace_factura, `https://drive/${drive.indexOf(file) + 1}`);
  assertStringIncludes(lastText(), "Guardé $32.000 en Ferretería El Maestro (Caja menor). Caja menor: $68.000.");
  assertEquals((tables.sesiones ?? []).length, 0);
});

Deno.test("caja menor por encima del tope: queda como «Pagó Carlos» y se avisa a Carlos", async () => {
  clearSent();
  gemini.replies.push(invoice({ number: "FE200", total: 250000 }));
  await processUpdate(inExpenses(BROTHER, photo("f2")));
  await processUpdate(tapExpenses(BROTHER, "gas:p:caja"));
  assertStringIncludes(lastTo(GROUP, EXPENSES_TOPIC), "Leyendo"); // la vista previa se edita en el mismo mensaje
  assertStringIncludes(lastText(), "Pasa del tope de la caja menor ($100.000)");
  assertStringIncludes(lastText(), "Pago: Pagó Carlos");
  assertStringIncludes(lastTo(CARLOS), "Tu hermano registró con caja menor una compra de $250.000");

  await processUpdate(tapExpenses(BROTHER, "gas:ok"));
  assertEquals(lastExpense().medio_pago, "Carlos");
  assertStringIncludes(lastText(), "(Pagó Carlos). Caja menor: $68.000.");
});

Deno.test("PDF por privado: faltan datos, se corrigen y se guarda", async () => {
  clearSent();
  gemini.replies.push(invoice({ date: null, total: null, number: null }));
  await processUpdate(message(CARLOS, pdf("pdf1")));
  assertStringIncludes(lastText(), "Fecha: <i>falta</i>");
  assertStringIncludes(lastText(), "Total: <i>falta</i>");
  assertEquals(gemini.calls.at(-1)!.body.contents[0].parts[1].inline_data.mime_type, "application/pdf");

  await processUpdate(tap(CARLOS, "gas:p:carlos"));
  await processUpdate(tap(CARLOS, "gas:ok"));
  assertEquals(callbackAnswers().at(-1), "Falta la fecha. Toca «Corregir campo».");

  await processUpdate(tap(CARLOS, "gas:c"));
  await processUpdate(tap(CARLOS, "gas:f:total"));
  assertStringIncludes(lastText(), "Escribe el total");
  await processUpdate(message(CARLOS, { text: "lo que sea" }));
  assertStringIncludes(lastText(), "No entendí el valor");
  await processUpdate(message(CARLOS, { text: "45 mil" }));
  assertStringIncludes(lastText(), "Total: $45.000");

  await processUpdate(tap(CARLOS, "gas:c"));
  await processUpdate(tap(CARLOS, "gas:f:date"));
  await processUpdate(message(CARLOS, { text: "ayer" }));
  assertStringIncludes(lastText(), "Fecha: mar 27 oct");

  await processUpdate(tap(CARLOS, "gas:c"));
  await processUpdate(tap(CARLOS, "gas:f:chapter"));
  assert(buttons().includes("Reserva para extras del albañil|gas:cap:1"));
  await processUpdate(tap(CARLOS, "gas:cap:1"));
  assertStringIncludes(lastText(), "Capítulo: Reserva para extras del albañil");

  await processUpdate(tap(CARLOS, "gas:ok"));
  const row = lastExpense();
  assertEquals([row.fecha, row.valor, row.medio_pago, row.registrado_por], ["2026-10-27", 45000, "Carlos", "Carlos"]);
  assertEquals(row.capitulo, "Reserva para extras del albañil");
  const file = drive.find((f) => f.name === "2026-10-27 Ferretería El Maestro sin número - 45.000.pdf")!;
  assertEquals(file.mimeType, "application/pdf");
});

Deno.test("un botón viejo no cambia la compra en curso", async () => {
  clearSent();
  gemini.replies.push(invoice({ number: "FE300" }));
  await processUpdate(inExpenses(BROTHER, photo("f3")));
  await processUpdate(tap(BROTHER, "gas:ok", GROUP, EXPENSES_TOPIC, 1));
  assertEquals(callbackAnswers().at(-1), "Ese botón ya no está activo.");
  await processUpdate(tapExpenses(BROTHER, "gas:x"));
  assertEquals(lastText(), "Cancelado. No guardé nada.");
});

Deno.test("compra sin factura: hasta $10.000 y una por día", async () => {
  clearSent();
  await processUpdate(inExpenses(BROTHER, { text: "/gasto" }));
  await processUpdate(tapExpenses(BROTHER, "gas:sf"));
  assertStringIncludes(lastText(), "Sin factura, máximo $10.000.");
  gemini.replies.push({
    supplier: "Ferretería de la esquina",
    items: "Clavos",
    chapter: "Materiales de obra y pintura",
  });
  await processUpdate(inExpenses(BROTHER, photo("p1", "Clavos en la ferretería de la esquina, 8 mil")));
  assertStringIncludes(lastText(), "Compra sin factura");
  assertStringIncludes(lastText(), "Total: $8.000");
  await processUpdate(tapExpenses(BROTHER, "gas:p:caja"));
  await processUpdate(tapExpenses(BROTHER, "gas:ok"));
  const row = lastExpense();
  assertEquals([row.valor, row.numero_factura, row.medio_pago], [8000, "", "caja menor"]);
  assertStringIncludes(String(row.nota), "Sin factura. Clavos");
  assert(drive.some((f) => f.name === "2026-10-28 Ferretería de la esquina sin factura - 8.000.jpg"));

  // Segunda en el mismo día: no.
  await processUpdate(inExpenses(BROTHER, { text: "/gasto" }));
  await processUpdate(tapExpenses(BROTHER, "gas:sf"));
  assertStringIncludes(lastText(), "Hoy ya hay 1 compra sin factura. El máximo es 1 por día.");

  // Al otro día, por encima del máximo: no (y no gasta Gemini).
  clock.now = () => new Date("2026-10-29T15:00:00Z");
  try {
    const calls = gemini.calls.length;
    await processUpdate(inExpenses(BROTHER, { text: "/gasto" }));
    await processUpdate(tapExpenses(BROTHER, "gas:sf"));
    await processUpdate(inExpenses(BROTHER, photo("p2")));
    assertStringIncludes(lastText(), "Escribe la nota");
    await processUpdate(inExpenses(BROTHER, { text: "Tornillos, 15 mil" }));
    assertStringIncludes(lastText(), "Sin factura solo se aceptan compras de hasta $10.000. Pide la factura.");
    assertEquals(gemini.calls.length, calls);
    assertEquals((tables.sesiones ?? []).length, 0);
  } finally {
    clock.now = () => new Date("2026-10-28T15:00:00Z");
  }
});

Deno.test("Gemini sin cuota: avisa, reintenta y sigue; si vuelve a fallar, espera más", async () => {
  clearSent();
  gemini.replies.push({ status: 429 }, invoice({ number: "FE400" }));
  await processUpdate(inExpenses(BROTHER, photo("f4")));
  const toTopic = sent.filter((e) => e.method === "sendMessage").map((e) => e.params.text);
  assertEquals(toTopic.slice(0, 3), ["Leyendo la factura…", "Lo proceso en unos minutos.", "Leyendo la factura…"]);
  assertStringIncludes(lastText(), "Número: FE400");
  assertEquals((tables.cola_reintentos ?? []).length, 0);
  await processUpdate(tapExpenses(BROTHER, "gas:x"));

  gemini.replies.push({ status: 429 }, { status: 429 });
  await processUpdate(inExpenses(BROTHER, photo("f5")));
  const [queued] = tables.cola_reintentos;
  assertEquals(queued.intentos, 1);
  assert(String(queued.proximo_intento) > new Date().toISOString()); // dentro de unos minutos
  tables.cola_reintentos.length = 0;
});
