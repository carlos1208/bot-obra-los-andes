// Reporte diario de punta a punta: nota → «¿Quisiste decir esto?» → resumen del día → «Cerrar el reporte» →
// tareas terminadas por número («2-3») → lo esperado → vista previa con el avance → guardar (uno por día).
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.19";
import {
  appends,
  BROTHER,
  buttons,
  CARLOS,
  clearSent,
  clock,
  EXPENSES_TOPIC,
  gemini,
  GROUP,
  lastText,
  lastTo,
  message,
  photo,
  processUpdate,
  REPORTS_TOPIC,
  resetSheet,
  rowsOf,
  sent,
  tables,
  tap,
  timing,
  voice,
} from "./_world.ts";

clock.now = () => new Date("2026-10-28T22:00:00Z"); // mié 28 oct, 17:00 en Bogotá
timing.retryWaitMs = 0;

const say = (from: number, extra: Record<string, unknown>) => message(from, extra, GROUP, REPORTS_TOPIC);
const press = (from: number, data: string) => tap(from, data, GROUP, REPORTS_TOPIC);
const task = (id: string) => rowsOf("Tareas").find((r) => r.id === id)!;
const beam = () => rowsOf("Esperado").find((r) => r.fecha === "2026-10-28")!;
const promptOf = (call: { body: any }) =>
  call.body.contents[0].parts.map((p: { text?: string }) => p.text ?? "").join("\n");
const texts = () => sent.filter((e) => e.method === "sendMessage").map((e) => String(e.params.text));

/** Una nota confirmada: Gemini la lee, «Sí», y Gemini arma el resumen del día. */
async function confirmedNote(text: string, daySummary: string) {
  gemini.replies.push({ transcript: text, summary: text }, { summary: daySummary, warnings: [] });
  await processUpdate(say(BROTHER, { text }));
  await processUpdate(press(BROTHER, "rep:q:1"));
}

Deno.test("reporte completo: nota de voz, resumen, tareas «2- 3», lo esperado, avance y guardado", async () => {
  await resetSheet();
  clearSent();
  gemini.replies.push({
    transcript: "Hoy se terminó de demoler el muro y se instaló la viga",
    summary: "Se terminó de demoler el muro y se instaló la viga.",
  });
  await processUpdate(say(BROTHER, voice("v1")));
  assertEquals(gemini.calls.at(-1)!.body.contents[0].parts[1].inline_data.mime_type, "audio/ogg");
  assertStringIncludes(lastText(), "Escuché: «Hoy se terminó de demoler el muro y se instaló la viga»");
  assertStringIncludes(lastText(), "¿Quisiste decir esto?</b>\nSe terminó de demoler el muro y se instaló la viga.");
  assertEquals(rowsOf("Notas").length, 0); // nada escrito hasta el «Sí»

  gemini.replies.push({ summary: "• Se demolió el muro.\n• Se instaló la viga.", warnings: [] });
  await processUpdate(press(BROTHER, "rep:q:1"));
  const [note] = rowsOf("Notas");
  assertEquals([note.fecha, note.hora, note.reportado_por, note.tipo], ["2026-10-28", "17:00", "Hermano", "voz"]);
  assertEquals(note.resumen, "Se terminó de demoler el muro y se instaló la viga.");
  assertStringIncludes(
    promptOf(gemini.calls.at(-1)!),
    "1. [17:00] Se terminó de demoler el muro y se instaló la viga.",
  );
  assertStringIncludes(lastText(), "Resumen del día – mié 28 oct</b> (1 nota)");
  assertEquals(buttons(), ["Cerrar el reporte|rep:cerrar"]);

  // Lista numerada de todas las pendientes, por sección, con las atrasadas marcadas.
  await processUpdate(press(BROTHER, "rep:cerrar"));
  const list = texts().filter((t) => t.includes("¿Qué tareas se terminaron hoy?") || t.startsWith("<b>")).join("\n");
  for (
    const part of [
      "<b>Cocina</b>",
      "<b>Baño social</b>",
      "<b>Baño principal</b>",
      "02 Demoler parte alta del muro cocina-sala ⏰",
      "Z1 ",
    ]
  ) {
    assertStringIncludes(list, part);
  }
  assert(texts().every((t) => t.length <= 4096));
  assertEquals(list.match(/<b>Cocina<\/b>/g)!.length, 1); // cada sección en un solo bloque
  assertEquals(buttons(), ["Ninguna|rep:t:no"]);

  await processUpdate(say(BROTHER, { text: "2- 3" }));
  assertStringIncludes(lastText(), "Entendí que se terminaron (02-03):\n02 Demoler parte alta del muro cocina-sala");
  await processUpdate(press(BROTHER, "rep:t:ok"));

  // Lo esperado de hoy: «No llegó» avisa a Carlos en ese momento.
  assertStringIncludes(lastText(), "¿Llegó lo esperado hoy?");
  await processUpdate(press(BROTHER, "rep:e:0:0"));
  assertEquals(lastTo(CARLOS), "⚠️ Hoy no llegó: Viga instalada y puntales retirados. Lo reportó tu hermano.");
  await processUpdate(press(BROTHER, "rep:e:fin"));

  const preview = lastText();
  for (
    const line of [
      "REPORTE – mié 28 oct\nResumen del día:\n• Se demolió el muro.\n• Se instaló la viga.",
      "Hermano manifestó que terminó las tareas 02 Demoler parte alta del muro cocina-sala; 03 Pintar viga",
      "Avance de la obra: 3 % (a hoy debería ir en 7 %; desvío −4 %)",
      "Avance de Cocina: 10 % (a hoy debería ir en 10 %; desvío 0 %)",
      "Se espera que ahora continúen con: 00 Triple A",
      "Compras: ninguna · Caja menor: $100.000",
      "¿Llegó lo esperado hoy?: no: Viga instalada y puntales retirados",
      "¿Lo guardo?",
    ]
  ) assertStringIncludes(preview, line);
  assertEquals(rowsOf("Reportes").length, 0);

  await processUpdate(press(BROTHER, "rep:ok"));
  const [row] = rowsOf("Reportes");
  assertEquals([row.fecha, row.hora, row.reportado_por], ["2026-10-28", "17:00", "Hermano"]);
  assertEquals(row.resumen_del_dia, "• Se demolió el muro.\n• Se instaló la viga.");
  assertEquals(row.tareas_terminadas, "02-03");
  assertEquals([row.avance_obra_pct, row.avance_esperado_pct, row.desvio_pct], [3, 7, -4]);
  assertEquals(row.para_continuar, "00-01-04");
  assertEquals(row.no_llego, "Viga instalada y puntales retirados");
  assertEquals([task("02").estado, task("03").estado], ["terminada", "terminada"]);
  assertEquals([beam().llego, beam().confirmado_por], ["no", "Hermano"]);
  assertStringIncludes(lastTo(CARLOS), "Tu hermano guardó el reporte:");
  assertEquals((tables.sesiones ?? []).length, 0);
  assert(appends.every((q) => !q.includes("INSERT_ROWS"))); // las filas nuevas no copian el formato del encabezado
});

Deno.test("nota con «No»: aclaración, se vuelve a preguntar y queda una sola nota; descartar no guarda", async () => {
  await resetSheet();
  clearSent();
  gemini.replies.push({ transcript: "Se subió el murete", summary: "Se subió el murete." });
  await processUpdate(say(BROTHER, voice("v2")));
  await processUpdate(press(BROTHER, "rep:q:0"));
  assertEquals(lastText(), "¿Quieres aclarar con texto u otro audio? Mándalo aquí.");

  gemini.replies.push({ transcript: "Faltó el segundo", summary: "Se subió un murete; falta el segundo." });
  await processUpdate(say(BROTHER, { text: "Faltó el segundo" }));
  const read = promptOf(gemini.calls.at(-1)!);
  assertStringIncludes(read, "Nota original: Se subió el murete");
  assertStringIncludes(read, "Aclaración: Faltó el segundo");
  assertStringIncludes(lastText(), "Se subió un murete; falta el segundo.");
  gemini.replies.push({ summary: "• Se subió un murete; falta el segundo.", warnings: [] });
  await processUpdate(press(BROTHER, "rep:q:1"));
  const notes = rowsOf("Notas");
  assertEquals(notes.length, 1);
  assertEquals(notes[0].transcripcion, "Se subió el murete\nAclaración: Faltó el segundo");

  // Descartar: no se guarda; se vuelve a mostrar el resumen con lo que sí hay.
  gemini.replies.push({ transcript: "blablá", summary: "" });
  await processUpdate(say(BROTHER, { text: "blablá" }));
  assertStringIncludes(lastText(), "No entendí la nota.");
  await processUpdate(press(BROTHER, "rep:q:0"));
  gemini.replies.push({ summary: "• Se subió un murete; falta el segundo.", warnings: ["Ejemplo de aviso"] });
  await processUpdate(press(BROTHER, "rep:q:x"));
  assertEquals(rowsOf("Notas").length, 1);
  assertStringIncludes(lastText(), "(1 nota)");
  assertStringIncludes(lastText(), "⚠️ Revisa: Ejemplo de aviso");
});

Deno.test("varias notas seguidas esperan su turno y el resumen se arma una sola vez", async () => {
  await resetSheet();
  clearSent();
  gemini.replies.push({ transcript: "Llegó Triple A", summary: "Llegó Triple A y restableció el agua." });
  await processUpdate(say(BROTHER, { text: "Llegó Triple A" }));
  await processUpdate(say(BROTHER, { text: "Se acabó el estuco" }));
  assertStringIncludes(lastText(), "Primero responde si entendí bien la nota anterior");
  const before = gemini.calls.length;
  gemini.replies.push({ transcript: "Se acabó el estuco", summary: "Se acabó el estuco; se compró otra bolsa." });
  await processUpdate(press(BROTHER, "rep:q:1"));
  assertStringIncludes(lastText(), "Se acabó el estuco; se compró otra bolsa.");
  gemini.replies.push({ summary: "• Triple A restableció el agua.\n• Se compró otra bolsa de estuco.", warnings: [] });
  await processUpdate(press(BROTHER, "rep:q:1"));
  assertEquals(gemini.calls.length, before + 2); // la segunda nota y un solo resumen
  assertStringIncludes(lastText(), "(2 notas)");
  assertEquals(rowsOf("Notas").length, 2);
});

Deno.test("actualizar el reporte del día: lista con las ya marcadas, desmarcar vuelve a pendiente", async () => {
  await resetSheet();
  clearSent();
  await confirmedNote("Se demolió el muro y se pintó la viga", "• Muro y viga.");
  await processUpdate(press(BROTHER, "rep:cerrar"));
  await processUpdate(say(BROTHER, { text: "99" }));
  assertStringIncludes(lastText(), "No entendí los números. No encontré entre las pendientes: 99.");
  await processUpdate(say(BROTHER, { text: "2-3" }));
  await processUpdate(press(BROTHER, "rep:t:otra")); // «No, escribir de nuevo»
  await processUpdate(say(BROTHER, { text: "2-3" }));
  await processUpdate(press(BROTHER, "rep:t:ok"));
  await processUpdate(press(BROTHER, "rep:e:0:1"));
  await processUpdate(press(BROTHER, "rep:e:fin"));
  await processUpdate(press(BROTHER, "rep:ok"));
  assertEquals(rowsOf("Reportes")[0].tareas_terminadas, "02-03");

  // Otra nota después de guardar: «Actualizar el reporte».
  await confirmedNote("Corrijo, la viga no se pintó", "• Muro demolido. La viga no se pintó.");
  assertStringIncludes(lastText(), "El reporte de hoy ya está guardado.");
  assertEquals(buttons(), ["Actualizar el reporte|rep:cerrar"]);
  await processUpdate(press(BROTHER, "rep:cerrar"));
  assert(/\n03 Pintar viga[^\n]*✔ marcada hoy/.test(texts().join("\n")));
  assert(buttons().includes("Dejar las mismas (02-03)|rep:t:igual"));
  await processUpdate(say(BROTHER, { text: "2" }));
  await processUpdate(press(BROTHER, "rep:t:ok")); // lo esperado ya estaba marcado: va directo a la vista previa
  assertStringIncludes(
    lastText(),
    "Hermano manifestó que terminó la tarea 02 Demoler parte alta del muro cocina-sala.",
  );
  assertStringIncludes(lastText(), "Ya hay un reporte de hoy. ¿Lo actualizo con este?");
  await processUpdate(press(BROTHER, "rep:ok"));
  const reports = rowsOf("Reportes");
  assertEquals(reports.length, 1);
  assertEquals(reports[0].tareas_terminadas, "02");
  assertEquals([task("02").estado, task("03").estado], ["terminada", "pendiente"]);
  assertStringIncludes(lastTo(CARLOS), "Tu hermano actualizó el reporte:");
});

Deno.test("«Ninguna» y «Agregar compra» desde la vista previa (la factura puede llegar por Gastos)", async () => {
  await resetSheet();
  clearSent();
  await confirmedNote("Hoy solo se limpió", "• Se limpió la obra.");
  await processUpdate(press(BROTHER, "rep:cerrar"));
  await processUpdate(press(BROTHER, "rep:t:no"));
  await processUpdate(press(BROTHER, "rep:e:0:1"));
  await processUpdate(press(BROTHER, "rep:e:fin"));
  assertStringIncludes(lastText(), "Tareas terminadas: ninguna hoy.");
  assertStringIncludes(lastText(), "Avance de la obra: 0 % (a hoy debería ir en 7 %; desvío −7 %)");

  await processUpdate(press(BROTHER, "rep:compra"));
  assertStringIncludes(lastText(), "Manda la foto o el PDF de la factura");
  gemini.replies.push({
    supplier: "Homecenter",
    tax_id: null,
    date: "2026-10-28",
    number: "77",
    items: ["Brocha"],
    total: 12000,
    chapter: "Materiales de obra y pintura",
  });
  await processUpdate(message(BROTHER, photo("r2"), GROUP, EXPENSES_TOPIC));
  await processUpdate(tap(BROTHER, "gas:p:caja", GROUP, EXPENSES_TOPIC));
  await processUpdate(tap(BROTHER, "gas:ok", GROUP, EXPENSES_TOPIC));
  // La vista previa vuelve al tema Reportes con la compra.
  assertStringIncludes(lastTo(GROUP, REPORTS_TOPIC), "Compras: Brocha en Homecenter, $12.000 · Caja menor: $88.000");
  await processUpdate(press(BROTHER, "rep:x"));
});

Deno.test("/reporte y comandos: dónde y cuándo", async () => {
  await resetSheet();
  clearSent();
  await processUpdate(message(CARLOS, { text: "/reporte" }));
  assertEquals(lastText(), "El reporte se hace en el tema Reportes.");
  await processUpdate(say(BROTHER, { text: "/reporte" }));
  assertEquals(lastText(), "Cuéntame qué se hizo hoy, en texto o en una nota de voz.");
  await confirmedNote("Se resanó el vano", "• Se resanó el vano.");
  gemini.replies.push({ summary: "• Se resanó el vano.", warnings: [] });
  await processUpdate(say(BROTHER, { text: "/reporte" }));
  assertStringIncludes(lastText(), "Resumen del día – mié 28 oct</b> (1 nota)");
  // Un comando que no existe no se toma como nota.
  const calls = gemini.calls.length;
  await processUpdate(say(BROTHER, { text: "/pago" }));
  assertEquals(gemini.calls.length, calls);
});

Deno.test("Gemini sin cuota al resumir el día: la nota no se guarda dos veces", async () => {
  await resetSheet();
  clearSent();
  gemini.replies.push({ transcript: "Hoy sin novedad", summary: "Sin novedad." }, { status: 429 }, {
    summary: "• Sin novedad.",
    warnings: [],
  });
  await processUpdate(say(BROTHER, { text: "Hoy sin novedad" }));
  await processUpdate(press(BROTHER, "rep:q:1"));
  assertEquals(rowsOf("Notas").length, 1);
  assert(sent.some((e) => e.params.text === "Lo proceso en unos minutos."));
  assertStringIncludes(lastText(), "• Sin novedad.");
});
