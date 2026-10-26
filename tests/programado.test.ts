// Fase 6: avisos programados con la fecha simulada (lunes, diario, festivo y cierre del sábado).
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.19";
import {
  BROTHER,
  buttons,
  CARLOS,
  clearSent,
  clock,
  drive,
  GROUP,
  lastText,
  processUpdate,
  REPORTS_TOPIC,
  resetSheet,
  rowsOf,
  sent,
  sheet,
  tap,
} from "./_world.ts";
import { runJob } from "../supabase/functions/programado/jobs.ts";
import { handler } from "../supabase/functions/programado/handler.ts";

const on = (
  iso: string,
  hour = 17,
) => (clock.now = () => new Date(`${iso}T${String(hour).padStart(2, "0")}:00:00-05:00`));
const messages = () => sent.filter((e) => e.method === "sendMessage");
const toTopic = () =>
  messages().filter((e) => e.params.chat_id === GROUP && e.params.message_thread_id === REPORTS_TOPIC)
    .map((e) => String(e.params.text));
const toCarlos = () => messages().filter((e) => e.params.chat_id === CARLOS).map((e) => String(e.params.text));

function addRow(tab: string, values: Record<string, unknown>) {
  const headers = sheet[tab][0] as string[];
  sheet[tab].push(headers.map((h) => values[h] ?? ""));
}
function setCell(tab: string, match: (r: Record<string, unknown>) => boolean, column: string, value: unknown) {
  const headers = sheet[tab][0] as string[];
  const i = rowsOf(tab).findIndex(match);
  sheet[tab][i + 1][headers.indexOf(column)] = value;
}

Deno.test("lunes: objetivos y lo esperado de la semana, al tema Reportes y a Carlos", async () => {
  await resetSheet();
  clearSent();
  on("2026-10-26", 7);
  const result = await runJob("lunes");
  assertEquals(result.fecha, "2026-10-26");
  const [topic] = toTopic();
  assertEquals(toCarlos(), [topic]);
  assertStringIncludes(
    topic,
    "<b>SEMANA 1 – lun 26 oct a sáb 31 oct</b>\n\n<b>Objetivos de la semana</b>\n• <b>Albañil:</b> Demoler",
  );
  assertStringIncludes(topic, "• <b>Hermano:</b> Aviso a la administración");
  assertStringIncludes(topic, "<b>Lo esperado de la semana</b>\n• lun 26 oct: El albañil empieza la obra (tarea 02)");
  assertStringIncludes(topic, "• mié 28 oct: Viga instalada y puntales retirados (tarea 03)");
  assert(!topic.includes("festivo"));

  // El 2 de noviembre es festivo: igual llegan los objetivos, con el aviso.
  clearSent();
  on("2026-11-02", 7);
  await runJob("lunes");
  assertStringIncludes(toTopic()[0], "<b>SEMANA 2 – lun 2 nov a sáb 7 nov</b>\nHoy es festivo: no se trabaja.");

  // Después de la obra no hay nada que mandar.
  clearSent();
  on("2027-01-11", 7);
  assertEquals((await runJob("lunes")).enviado, ["nada: la semana no tiene objetivos ni nada esperado"]);
  assertEquals(messages().length, 0);
});

Deno.test("diario: pendientes atrasados todos los días hasta que se marquen, y el recordatorio del reporte", async () => {
  await resetSheet();
  clearSent();
  on("2026-10-28");
  const result = await runJob("diario");
  assertEquals(result.enviado, ["recordatorio de pendientes atrasados (4)", "recordatorio del reporte"]);
  const reminder = "⏰ <b>Pendientes atrasados</b> (se recuerdan cada día hasta que se marquen)\n\n" +
    "<b>Lo esperado sin confirmar</b>\n" +
    "• lun 26 oct (hace 2 días de obra): El albañil empieza la obra (tarea 02)\n" +
    "• Hoy: Viga instalada y puntales retirados (tarea 03)\n\n" +
    "<b>Tareas atrasadas</b>\n" +
    "• 01 Aviso a la administración; compras de la semana 1: 2 días de atraso (fin lun 26 oct)\n" +
    "• 02 Demoler parte alta del muro cocina-sala: 1 día de atraso (fin mar 27 oct)";
  const [topic, reportReminder] = toTopic();
  assertStringIncludes(topic, reminder);
  assertStringIncludes(topic, "Se marcan en el reporte del día");
  assertEquals(
    reportReminder,
    "⏰ Todavía no hay reporte de hoy. Manda por aquí las notas del día (voz o texto) y toca «Cerrar el reporte».",
  );
  // En el tema, sin botones; a Carlos, con un botón por pendiente.
  const topicMessage = messages().find((e) => e.params.chat_id === GROUP)!;
  assertEquals(topicMessage.params.reply_markup, undefined);
  assertStringIncludes(toCarlos()[0], `${reminder}\n\nToca lo que ya se hizo para marcarlo.`);
  assertEquals(buttons().map((b) => b.split("|")[1]), ["atr:e:2", "atr:e:3", "atr:t:01", "atr:t:02"]);
  assert(buttons()[0].startsWith("✅ Llegó: El albañil empieza la obra"));
  assert(buttons()[2].startsWith("✅ Terminada: 01 Aviso"));
  assertEquals(rowsOf("Esperado").filter((r) => r.aviso_enviado === "sí").map((r) => r.fecha), [
    "2026-10-26",
    "2026-10-28",
  ]);

  // Carlos marca la tarea 01 y que llegó la viga (cada uno pregunta antes de escribir).
  await processUpdate(tap(CARLOS, "atr:t:01"));
  assertEquals(lastText(), "¿Marco la tarea 01 «Aviso a la administración; compras de la semana 1» como terminada?");
  assertEquals(rowsOf("Tareas").find((r) => r.id === "01")!.estado, "pendiente");
  await processUpdate(tap(CARLOS, "atr:T:01"));
  assertEquals(rowsOf("Tareas").find((r) => r.id === "01")!.estado, "terminada");
  assertStringIncludes(lastText(), "✅ Tarea 01 «Aviso a la administración; compras de la semana 1» terminada.");
  await processUpdate(tap(CARLOS, "atr:e:3"));
  assertEquals(lastText(), "¿Marco que llegó «Viga instalada y puntales retirados» (mié 28 oct)?");
  await processUpdate(tap(CARLOS, "atr:E:3"));
  const viga = rowsOf("Esperado").find((r) => r.fecha === "2026-10-28")!;
  assertEquals([viga.llego, viga.confirmado_por], ["sí", "Carlos"]);
  // Su hermano no puede marcar.
  await processUpdate(tap(BROTHER, "atr:t:02"));
  assertEquals(rowsOf("Tareas").find((r) => r.id === "02")!.estado, "pendiente");

  // Al otro día se repite lo que sigue pendiente (no lo marcado).
  clearSent();
  addRow("Reportes", { fecha: "2026-10-29", hora: "16:30", reportado_por: "Hermano" });
  on("2026-10-29");
  assertEquals((await runJob("diario")).enviado, ["recordatorio de pendientes atrasados (4)"]);
  const next = toCarlos()[0];
  assertStringIncludes(next, "• lun 26 oct (hace 3 días de obra): El albañil empieza la obra (tarea 02)");
  assertStringIncludes(next, "• 02 Demoler parte alta del muro cocina-sala: 2 días de atraso (fin mar 27 oct)");
  assertStringIncludes(next, "• 03 Pintar viga de acero"); // terminaba el 28: ahora está atrasada
  assert(!next.includes("01 Aviso"));
  assert(!next.includes("Viga instalada"));
});

Deno.test("diario: «no llegó» se sigue recordando hasta que llegue; festivo y domingo, sin avisos", async () => {
  await resetSheet();
  clearSent();
  setCell("Esperado", (r) => r.fecha === "2026-10-28", "llego", "no");
  setCell("Esperado", (r) => r.fecha === "2026-10-26", "llego", "sí");
  addRow("Reportes", { fecha: "2026-10-28", hora: "16:30", reportado_por: "Hermano" });
  on("2026-10-28");
  assertEquals((await runJob("diario")).enviado, ["recordatorio de pendientes atrasados (3)"]);
  assertStringIncludes(toCarlos()[0], "• Hoy: Viga instalada y puntales retirados (tarea 03) · no llegó");
  assert(!toCarlos()[0].includes("El albañil empieza la obra"));

  clearSent();
  on("2026-11-02");
  assertEquals((await runJob("diario")).enviado, ["sin avisos: hoy es festivo"]);
  on("2026-11-01");
  assertEquals((await runJob("diario")).enviado, ["sin avisos: hoy no se trabaja"]);
  assertEquals(messages().length, 0);
});

Deno.test("sábado: cierre de la semana", async () => {
  await resetSheet();
  clearSent();
  setCell("Objetivos", (r) => r.persona === "Albañil" && r.inicio_semana === "2026-10-26", "cumplido", "sí");
  setCell("Esperado", (r) => r.fecha === "2026-10-28", "llego", "no");
  setCell("Esperado", (r) => r.fecha === "2026-10-26", "llego", "sí");
  addRow("Gastos", {
    fecha: "2026-10-20",
    proveedor: "Ferretería",
    items: "Cemento gris 50 kg",
    valor: 32000,
    medio_pago: "caja menor",
    cuenta_12M: "sí",
    registrado_el: "2026-10-27",
  });
  addRow("Reportes", { fecha: "2026-10-31", hora: "16:00", reportado_por: "Hermano" });
  drive.push({
    id: "a1",
    name: "ANTES 2026-10-26 (1).jpg",
    parents: ["carpeta-f05"],
    mimeType: "image/jpeg",
    appProperties: {
      tipo: "antes",
      codigo: "F05",
      nombre: "Ducha baño social",
      tareas: "20",
      hitos: "H3",
      estado: "por validar",
    },
  });
  on("2026-10-31");
  const result = await runJob("diario");
  assertEquals(result.enviado.at(-1), "cierre de la semana");
  const close = toTopic().at(-1)!;
  assertEquals(toCarlos().at(-1), close);
  assertStringIncludes(close, "<b>CIERRE DE LA SEMANA 1 – lun 26 oct a sáb 31 oct</b>");
  assertStringIncludes(close, "<b>Objetivos cumplidos</b>\n✅ Albañil: Demoler");
  assertStringIncludes(close, "<b>Objetivos pendientes</b>\n• Hermano: Aviso a la administración");
  assertStringIncludes(
    close,
    "<b>Lo esperado que no llegó</b>\n• mié 28 oct: Viga instalada y puntales retirados (tarea 03): no llegó",
  );
  assert(!close.includes("El albañil empieza la obra"));
  // 01 terminaba el lun 26 oct: mar a sáb son 5 días de obra de atraso.
  assertStringIncludes(
    close,
    "• 01 Aviso a la administración; compras de la semana 1: 5 días de atraso (fin lun 26 oct)",
  );
  assertStringIncludes(
    close,
    "<b>Gastos de la semana</b>\n• mar 27 oct: Cemento gris 50 kg en Ferretería, $32.000 (caja menor)\nTotal: $32.000",
  );
  assertStringIncludes(
    close,
    "🧾 Hoy toca el arqueo de la caja menor: efectivo esperado $68.000 + facturas sin reponer $32.000 = $100.000.",
  );
  assertStringIncludes(close, "<b>Pares por validar</b>\n• F05 Ducha baño social (tarea 20; H3)");
});

Deno.test("la función pide el secreto, una tarea válida y una fecha AAAA-MM-DD", async () => {
  await resetSheet();
  Deno.env.set("PROGRAMADO_SECRET", "s3creto");
  const call = (body: unknown, secret = "s3creto") =>
    handler(
      new Request("https://x/functions/v1/programado", {
        method: "POST",
        headers: { "X-Programado-Secret": secret },
        body: JSON.stringify(body),
      }),
    );
  assertEquals((await call({ tarea: "lunes" }, "otro")).status, 401);
  assertEquals((await call({ tarea: "martes" })).status, 400);
  assertEquals((await call({ tarea: "lunes", fecha: "31/02/2026" })).status, 400);
  clearSent();
  const r = await call({ tarea: "lunes", fecha: "2026-10-26" });
  assertEquals(r.status, 200);
  assertEquals(await r.json(), {
    tarea: "lunes",
    fecha: "2026-10-26",
    enviado: ["objetivos (3) y lo esperado (6) de la semana"],
  });
  assertEquals(toCarlos().length, 1);
});
