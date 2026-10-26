// Fase 5 de punta a punta: pago (sin ligarlo a un hito) con su control, reposición de caja menor con arqueo,
// «Marcar H# cumplido», /pago y preguntas (una del hermano negada por hermano_ve_dinero).
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.19";
import {
  BROTHER,
  buttons,
  CARLOS,
  clearSent,
  clock,
  gemini,
  GROUP,
  lastText,
  message,
  processUpdate,
  resetSheet,
  rowsOf,
  sent,
  sheet,
  tables,
  tap,
  timing,
  voice,
} from "./_world.ts";

clock.now = () => new Date("2026-10-31T15:00:00Z"); // sáb 31 oct, 10:00 en Bogotá
timing.retryWaitMs = 0;

const read = (over: Record<string, unknown> = {}) => ({
  transcript: "",
  kind: "pago",
  payee: "albañil",
  concept: "Hito H1",
  amount: 700000,
  method: "Nequi",
  date: "2026-10-31",
  chapter: "Albañil (saldo de los 5 hitos)",
  topics: [],
  money: false,
  ...over,
});
const question = (topics: string[], money = false) =>
  read({ kind: "pregunta", payee: null, concept: null, amount: null, topics, money });

Deno.test("pago de 700.000 al albañil: vista previa sin hito, Pagos y Hitos sin tocar", async () => {
  await resetSheet();
  clearSent();
  gemini.replies.push(read());
  await processUpdate(message(CARLOS, { text: "le pagué 700 mil al albañil por el H1 por Nequi" }));
  assertEquals(sent.find((e) => e.method === "sendMessage")!.params.text, "Un momento…");
  // Gemini recibe la lista de a quién se paga, y nada de hitos.
  const call = gemini.calls.at(-1)!.body;
  const parts = call.contents[0].parts.map((p: { text?: string }) => p.text ?? "").join("\n");
  assertStringIncludes(parts, "A quién se paga: Albañil, Carpintero");
  assert(!parts.includes("Cocina abierta"));
  assertEquals(call.generationConfig.responseFormat.text.schema.properties.milestone, undefined);

  const preview = lastText();
  assertStringIncludes(
    preview,
    "<b>Pago</b>\nA quién: Albañil\nConcepto: Hito H1\nValor: $700.000\nMedio: Nequi\nFecha: sáb 31 oct\n" +
      "Capítulo: Albañil (saldo de los 5 hitos)\nCuenta en los 12 M: sí",
  );
  assert(!preview.includes("⚠️"));
  assertEquals(buttons(), ["Sí, guardar|pag:ok", "Corregir campo|pag:c", "Cancelar|pag:x"]);
  assertEquals(rowsOf("Pagos").length, 3); // nada escrito todavía

  const hitos = JSON.stringify(rowsOf("Hitos"));
  await processUpdate(tap(CARLOS, "pag:ok"));
  const pago = rowsOf("Pagos").at(-1)!;
  assertEquals(
    [pago.fecha, pago.a_quien, pago.concepto, pago.hito, pago.valor, pago.medio, pago.cuenta_12M, pago.registrado_por],
    ["2026-10-31", "Albañil", "Hito H1", "", 700000, "Nequi", "sí", "Carlos"],
  );
  assertEquals(JSON.stringify(rowsOf("Hitos")), hitos);
  assertEquals(
    lastText(),
    "Guardé $700.000 a Albañil.\nAl albañil se le ha pagado $900.000 de $4.500.000.\n" +
      "Disponible de los 12 M: $11.300.000.",
  );
  assertEquals((tables.sesiones ?? []).length, 0);
});

Deno.test("control: lo pagado al albañil por encima del total más la reserva", async () => {
  await resetSheet();
  clearSent();
  gemini.replies.push(read({ concept: "Pago al albañil", amount: 4_900_000 }));
  await processUpdate(message(CARLOS, { text: "le pagué 4,9 M al albañil" }));
  assertStringIncludes(
    lastText(),
    "⚠️ Con este pago, al albañil se le habrán pagado $5.100.000: pasa de $5.000.000 (total $4.500.000 + reserva $500.000).",
  );
  // Corregir el valor quita los avisos.
  await processUpdate(tap(CARLOS, "pag:c"));
  assert(buttons().includes("Valor|pag:f:amount"));
  await processUpdate(tap(CARLOS, "pag:f:amount"));
  await processUpdate(message(CARLOS, { text: "900 mil" }));
  assert(!lastText().includes("⚠️"));
  await processUpdate(tap(CARLOS, "pag:x"));
  assertEquals(lastText(), "Cancelado. No guardé nada.");
  assertEquals(rowsOf("Pagos").length, 3);
});

Deno.test("reposición de caja menor: Pagos con cuenta_12M = no y arqueo", async () => {
  await resetSheet();
  clearSent();
  // Compras de la semana con caja menor: 87.500.
  addExpense({
    fecha: "2026-10-27",
    proveedor: "Ferretería",
    valor: 52500,
    medio_pago: "caja menor",
    cuenta_12M: "sí",
  });
  addExpense({ fecha: "2026-10-29", proveedor: "Depósito", valor: 35000, medio_pago: "caja menor", cuenta_12M: "sí" });
  gemini.replies.push(
    read({ kind: "reposicion", payee: "Caja menor", amount: 87500, method: null }),
  );
  await processUpdate(message(CARLOS, voice("v1")));
  assertEquals(sent.find((e) => e.method === "sendMessage")!.params.text, "Escuchando…");
  assertEquals(gemini.calls.at(-1)!.body.contents[0].parts.at(-1).inline_data.mime_type, "audio/ogg");
  const preview = lastText();
  assertStringIncludes(
    preview,
    "<b>Reposición de caja menor</b>\nValor: $87.500\nMedio: —\nFecha: sáb 31 oct\nCuenta en los 12 M: no",
  );
  assertStringIncludes(preview, "Hoy: efectivo esperado $12.500 y facturas sin reponer $87.500.");

  await processUpdate(tap(CARLOS, "pag:ok"));
  const pago = rowsOf("Pagos").at(-1)!;
  assertEquals(
    [pago.a_quien, pago.concepto, pago.hito, pago.capitulo, pago.valor, pago.cuenta_12M],
    ["Caja menor", "Reposición de caja menor", "", "", 87500, "no"],
  );
  assertEquals(
    lastText(),
    "Guardé la reposición de $87.500.\n\n<b>Arqueo de caja menor</b>\nEfectivo esperado antes de reponer: $12.500\n" +
      "Facturas sin reponer: $87.500\nEfectivo + facturas = $100.000 (fondo de caja menor)\n" +
      "Con la reposición, la caja queda en $100.000.",
  );
});

Deno.test("/pago espera el pago; solo Carlos y solo por privado", async () => {
  await resetSheet();
  clearSent();
  await processUpdate(message(CARLOS, { text: "/pago" }, GROUP, 2));
  assertEquals(lastText(), "Los pagos van por tu privado con el bot.");
  await processUpdate(message(BROTHER, { text: "/pago" }));
  assertEquals(lastText(), "Los pagos los registra Carlos.");

  await processUpdate(message(CARLOS, { text: "/pago" }));
  assertStringIncludes(lastText(), "Escribe o dicta el pago.");
  gemini.replies.push(question(["pagos"], true));
  await processUpdate(message(CARLOS, { text: "¿cuánto le debo al albañil?" }));
  assertStringIncludes(lastText(), "No entendí el pago.");
  gemini.replies.push(
    read({ payee: "Drywall", concept: "Adelanto del drywall", amount: 300000 }),
  );
  await processUpdate(message(CARLOS, { text: "le di 300 mil al de drywall" }));
  assertStringIncludes(lastText(), "A quién: Drywall\nConcepto: Adelanto del drywall\nValor: $300.000");
  await processUpdate(tap(CARLOS, "pag:ok"));
  assertEquals(rowsOf("Pagos").at(-1)!.a_quien, "Drywall");
  assertStringIncludes(lastText(), "Guardé $300.000 a Drywall.\nDisponible de los 12 M: $11.700.000.");
});

Deno.test("Marcar H2 cumplido: criterio, cambiar fecha y guardar", async () => {
  await resetSheet();
  clearSent();
  const calls = gemini.calls.length;
  await processUpdate(message(CARLOS, { text: "Marcar H2 cumplido" }));
  assertEquals(gemini.calls.length, calls); // sin Gemini
  assertStringIncludes(lastText(), "<b>Marcar H2 cumplido</b>\nH2 Cocina en obra gris\nCriterio: Redes de cocina");
  assertStringIncludes(lastText(), "Fecha de cumplido: sáb 31 oct");
  await processUpdate(tap(CARLOS, "hit:f"));
  await processUpdate(message(CARLOS, { text: "ayer" }));
  assertStringIncludes(lastText(), "Fecha de cumplido: vie 30 oct");
  await processUpdate(tap(CARLOS, "hit:ok"));
  assertEquals(lastText(), "✅ H2 cumplido el vie 30 oct.");
  assertEquals(rowsOf("Hitos").find((r) => r.hito === "H2")!.fecha_cumplido, "2026-10-30");

  await processUpdate(message(BROTHER, { text: "marcar h3 cumplido" }));
  assertEquals(lastText(), "Los hitos los marca Carlos.");
});

Deno.test("preguntas: solo las pestañas del tema, «Dato de la hoja» y dinero negado al hermano", async () => {
  await resetSheet();
  clearSent();
  // 1. Carlos: dinero, por privado.
  gemini.replies.push(question(["presupuesto"], true), { answer: "Quedan $12.000.000 de los 12 M." });
  await processUpdate(message(CARLOS, { text: "¿cuánto queda de los 12 M?" }));
  assertEquals(lastText(), "Quedan $12.000.000 de los 12 M.\n\n<i>Dato de la hoja, 10:00</i>");
  const data = gemini.calls.at(-1)!.body.contents[0].parts[0].text as string;
  assertStringIncludes(data, "Disponible de los 12 M: $12.000.000 de $12.000.000.");
  assertStringIncludes(data, "## Presupuesto");
  assert(!data.includes("## Tareas"));

  // 2. El hermano: cronograma, sí.
  gemini.replies.push(question(["cronograma"]), { answer: "• 00 Triple A\n• 02 Demoler parte alta del muro" });
  await processUpdate(message(BROTHER, { text: "¿qué toca esta semana?" }));
  assertStringIncludes(lastText(), "• 00 Triple A\n• 02 Demoler parte alta del muro\n\n<i>Dato de la hoja, 10:00</i>");
  const week = gemini.calls.at(-1)!.body.contents[0].parts[0].text as string;
  assertStringIncludes(week, "Semana 1 de obra (lun 26 oct – sáb 31 oct).");
  assertStringIncludes(week, "Tareas de esta semana sin terminar: 00, 01, 02");
  assertStringIncludes(week, "2026-10-26");
  assert(!week.includes("## Pagos"));

  // 3. El hermano: dinero, no (hermano_ve_dinero = no). No gasta la segunda llamada a Gemini.
  gemini.replies.push(question(["pagos"], true));
  const calls = gemini.calls.length;
  await processUpdate(message(BROTHER, { text: "¿cuánto se le ha pagado al albañil?" }));
  assertEquals(lastText(), "Eso lo ve solo Carlos.");
  assertEquals(gemini.calls.length, calls + 1);

  // Los hitos sí, pero sin valores.
  gemini.replies.push(question(["hitos"]), { answer: "El H3 es el sáb 21 nov." });
  await processUpdate(message(BROTHER, { text: "¿cuándo es el H3?" }));
  const milestones = gemini.calls.at(-1)!.body.contents[0].parts[0].text as string;
  assertStringIncludes(milestones, "hito | nombre | fecha_estimada | criterio | fecha_cumplido | nota");
  assert(!milestones.includes("700000"));
});

Deno.test("por privado: lo que no es pago ni pregunta, y el pago del hermano", async () => {
  await resetSheet();
  clearSent();
  gemini.replies.push(read({ kind: "otro" }));
  await processUpdate(message(CARLOS, { text: "hola" }));
  assertStringIncludes(lastText(), "No entendí. Por aquí puedes hacer una pregunta de la obra");
  gemini.replies.push(read());
  await processUpdate(message(BROTHER, { text: "le pagué al albañil" }));
  assertEquals(lastText(), "Los pagos los registra Carlos.");
  assertEquals(rowsOf("Pagos").length, 3);
});

function addExpense(values: Record<string, unknown>) {
  const headers = sheet.Gastos[0] as string[];
  sheet.Gastos.push(headers.map((h) => values[h] ?? ""));
}
