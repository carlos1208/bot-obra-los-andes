// Gastos de punta a punta: factura → vista previa → caja menor o Carlos → guardar; tope; corregir campo;
// compra sin factura (máximo y una por día); PDF por privado; Gemini sin cuota; productos (lista, corrección
// y pestaña Productos); factura ya registrada; reintento cuando falla Productos.
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.19";
import {
  BROTHER,
  buttons,
  CARLOS,
  clearSent,
  clock,
  drive,
  EXPENSES_TOPIC,
  failAppend,
  gemini,
  GROUP,
  keyboardMessage,
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
  products: [{ name: "Cemento gris 50 kg", quantity: 1, unit: "und", total: 32000 }],
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
  assertEquals(row.registrado_el, "2026-10-28");
  const file = drive.find((f) => f.name === "2026-10-28 Ferretería El Maestro FE123 - 32.000.jpg")!;
  assertEquals(file.parents, [drive.find((f) => f.name === "Facturas")!.id]);
  assertEquals(row.enlace_factura, `https://drive/${drive.indexOf(file) + 1}`);
  assertStringIncludes(lastText(), "Guardé $32.000 en Ferretería El Maestro (Caja menor). Caja menor: $68.000.");
  assertEquals((tables.sesiones ?? []).length, 0);
  // Cada producto en Productos, con el número y el enlace de la factura.
  const product = rowsOf("Productos").at(-1)!;
  assertEquals(
    [product.fecha, product.numero_factura, product.producto, product.cantidad, product.valor_unitario],
    ["2026-10-28", "FE123", "Cemento gris 50 kg", 1, 32000],
  );
  assertEquals([product.valor_total, product.enlace_factura, product.registrado_el], [
    32000,
    row.enlace_factura,
    "2026-10-28",
  ]);
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
  const product = rowsOf("Productos").at(-1)!;
  assertEquals([product.producto, product.cantidad, product.valor_total, product.numero_factura], [
    "Clavos",
    1,
    8000,
    "",
  ]);

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

Deno.test("productos: la lista sale en la vista previa, se corrige y cada uno va a Productos", async () => {
  clearSent();
  gemini.replies.push(invoice({
    number: "FE500",
    total: 76000,
    products: [
      { name: "Cemento gris 50 kg", quantity: 2, unit: "und", total: 64000 },
      { name: "Brocha de 3 pulgadas", quantity: 1, unit: "und", total: null },
    ],
  }));
  await processUpdate(inExpenses(BROTHER, photo("f6")));
  assertStringIncludes(
    lastText(),
    "Productos (2):\n• 2 × Cemento gris 50 kg: $64.000\n• Brocha de 3 pulgadas: sin valor\nTotal: $76.000",
  );
  assertStringIncludes(lastText(), "⚠️ Falta el valor de 1 producto. Toca «Corregir campo».");

  // «Corregir campo» → «Productos»: manda la lista para copiarla y corregirla.
  await processUpdate(tapExpenses(BROTHER, "gas:c"));
  assert(buttons().includes("Productos|gas:f:products"));
  await processUpdate(tapExpenses(BROTHER, "gas:f:products"));
  assertEquals(lastText(), "2 Cemento gris 50 kg 64.000\n1 Brocha de 3 pulgadas");
  await processUpdate(inExpenses(BROTHER, { text: "2 Cemento gris 50 kg 64.000\nBrocha" }));
  assertStringIncludes(lastText(), "No entendí estas líneas:\nBrocha\n");
  await processUpdate(inExpenses(BROTHER, { text: "2 Cemento gris 50 kg 64.000\n1 Brocha de 3 pulgadas 10 mil" }));
  assertStringIncludes(lastText(), "⚠️ Los productos suman $74.000 y el total es $76.000. Toca «Corregir campo».");

  await processUpdate(tapExpenses(BROTHER, "gas:c"));
  await processUpdate(tapExpenses(BROTHER, "gas:f:products"));
  await processUpdate(
    inExpenses(BROTHER, { text: "2 Cemento gris 50 kg 64.000\n1 Brocha de 3 pulgadas 10 mil\n2,5 m2 Malla 2.000" }),
  );
  assertStringIncludes(lastText(), "• Brocha de 3 pulgadas: $10.000\n• 2,5 m2 Malla: $2.000");
  assert(!lastText().includes("⚠️"));

  await processUpdate(tapExpenses(BROTHER, "gas:p:carlos"));
  await processUpdate(tapExpenses(BROTHER, "gas:ok"));
  assertEquals(lastExpense().items, "Cemento gris 50 kg, Brocha de 3 pulgadas, Malla");
  const lines = rowsOf("Productos").slice(-3);
  assertEquals(
    lines.map((r) => [r.numero_factura, r.producto, r.cantidad, r.unidad, r.valor_unitario, r.valor_total]),
    [
      ["FE500", "Cemento gris 50 kg", 2, "und", 32000, 64000],
      ["FE500", "Brocha de 3 pulgadas", 1, "und", 10000, 10000],
      ["FE500", "Malla", 2.5, "m2", 800, 2000],
    ],
  );
  assert(lines.every((r) => r.enlace_factura === lastExpense().enlace_factura));
});

Deno.test("factura ya registrada: avisa en la vista previa y, si la registran mientras tanto, al guardar", async () => {
  clearSent();
  // Una de las 4 facturas de la semilla, con el número leído con espacio.
  gemini.replies.push(
    invoice({ supplier: "Easy", tax_id: "900.155.107-1", number: "EL02 1045207", date: "2026-09-22", total: 1834030 }),
  );
  await processUpdate(inExpenses(BROTHER, photo("f7")));
  assertStringIncludes(
    lastText(),
    "⚠️ Esta factura ya está registrada: Easy, mar 22 sep, $1.834.030 por Carlos. Si es la misma, toca «Cancelar».",
  );
  await processUpdate(tapExpenses(BROTHER, "gas:x"));

  gemini.replies.push(invoice({ number: "FE600" }));
  await processUpdate(inExpenses(BROTHER, photo("f8")));
  assert(!lastText().includes("ya está registrada"));
  await processUpdate(tapExpenses(BROTHER, "gas:p:carlos"));
  const brotherPreview = keyboardMessage;
  // Carlos registra la misma factura por privado (en PDF).
  gemini.replies.push(invoice({ number: "FE600" }));
  await processUpdate(message(CARLOS, pdf("f9")));
  await processUpdate(tap(CARLOS, "gas:p:carlos"));
  await processUpdate(tap(CARLOS, "gas:ok"));
  const count = rowsOf("Gastos").length;

  await processUpdate(tap(BROTHER, "gas:ok", GROUP, EXPENSES_TOPIC, brotherPreview));
  assertStringIncludes(
    lastText(),
    "⚠️ Esta factura ya está registrada: Ferretería El Maestro, mié 28 oct, $32.000, registrada el mié 28 oct por Carlos.",
  );
  assertEquals(rowsOf("Gastos").length, count);
  // Ya vio el aviso: si toca «Sí, guardar» otra vez, se guarda.
  await processUpdate(tap(BROTHER, "gas:ok", GROUP, EXPENSES_TOPIC, brotherPreview));
  assertEquals(rowsOf("Gastos").length, count + 1);
});

Deno.test("si falla Productos, «Sí, guardar» otra vez no repite el gasto ni la factura en Drive", async () => {
  clearSent();
  gemini.replies.push(invoice({ number: "FE700" }));
  await processUpdate(inExpenses(BROTHER, photo("f10")));
  await processUpdate(tapExpenses(BROTHER, "gas:p:carlos"));
  const [expenses, products, files] = [rowsOf("Gastos").length, rowsOf("Productos").length, drive.length];
  failAppend.add("Productos");
  await processUpdate(tapExpenses(BROTHER, "gas:ok"));
  assertEquals([rowsOf("Gastos").length, rowsOf("Productos").length], [expenses + 1, products]);
  assertStringIncludes(lastTo(GROUP, EXPENSES_TOPIC), "No pude procesar eso.");

  await processUpdate(tapExpenses(BROTHER, "gas:ok"));
  assertEquals([rowsOf("Gastos").length, rowsOf("Productos").length, drive.length], [
    expenses + 1,
    products + 1,
    files + 1,
  ]);
  assertStringIncludes(lastTo(GROUP, EXPENSES_TOPIC), "Guardé $32.000 en Ferretería El Maestro (Pagó Carlos).");
});
