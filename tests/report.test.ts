// Reporte diario de punta a punta: secciones con selección múltiple, «Agregar compra» y vuelta al reporte,
// «No llegó» avisado en el momento, «Otro» por voz, corregir sección, guardar, y reporte en texto libre.
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.19";
import {
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

Deno.test("reporte completo con botones, una compra en medio y guardado", async () => {
  await resetSheet();
  clearSent();
  await processUpdate(say(BROTHER, { text: "/reporte" }));
  assertStringIncludes(lastText(), "REPORTE – mié 28 oct");
  // Tareas de la semana (lun 26 – sáb 31) que no están terminadas: 10.
  assertEquals(buttons().filter((b) => b.includes("|rep:t:")).length, 10);

  await processUpdate(press(BROTHER, "rep:t:03"));
  await processUpdate(press(BROTHER, "rep:t:04"));
  assert(buttons().some((b) => b.startsWith("✅ 03")));
  await processUpdate(press(BROTHER, "rep:t1"));
  await processUpdate(press(BROTHER, "rep:s:03:t"));
  await processUpdate(press(BROTHER, "rep:s1"));
  assertStringIncludes(sent.filter((e) => e.method === "answerCallbackQuery").at(-1)!.params.text as string, "04");
  await processUpdate(press(BROTHER, "rep:s:04:a"));
  await processUpdate(press(BROTHER, "rep:s1"));

  // Secciones automáticas: objetivo (opción a: 1 de 7 con la 03 terminada), fotos, compras y caja menor.
  assertStringIncludes(lastText(), "Avance del objetivo semanal:</b> 1 de 7 tareas");
  assertStringIncludes(lastText(), "Caja menor:</b> $100.000");

  // «Agregar compra»: el flujo de gastos y vuelta al reporte con la compra y el saldo nuevos.
  await processUpdate(press(BROTHER, "rep:c"));
  assertStringIncludes(lastText(), "Manda la foto o el PDF de la factura");
  gemini.replies.push({
    supplier: "Ferretería El Maestro",
    tax_id: null,
    date: "2026-10-28",
    number: "FE9",
    items: ["Cemento gris 50 kg"],
    total: 32000,
    chapter: "Materiales de obra y pintura",
  });
  await processUpdate(say(BROTHER, photo("r1")));
  await processUpdate(press(BROTHER, "gas:p:caja"));
  await processUpdate(press(BROTHER, "gas:ok"));
  assertStringIncludes(lastText(), "Compras de hoy:</b> Cemento gris 50 kg en Ferretería El Maestro, $32.000");
  assertStringIncludes(lastText(), "Caja menor:</b> $68.000");
  await processUpdate(press(BROTHER, "rep:c1"));

  // ¿Llegó lo esperado? «No llegó» avisa a Carlos en ese momento.
  assertStringIncludes(lastText(), "Viga instalada y puntales retirados");
  await processUpdate(press(BROTHER, "rep:e:0:0"));
  assertEquals(lastTo(CARLOS), "⚠️ Hoy no llegó: Viga instalada y puntales retirados. Lo reportó tu hermano.");
  await processUpdate(press(BROTHER, "rep:e1"));

  await processUpdate(press(BROTHER, "rep:w:1")); // Llamé, sin fecha
  await processUpdate(press(BROTHER, "rep:n:0")); // Sin novedad…
  await processUpdate(press(BROTHER, "rep:n:1")); // …se quita al marcar «Faltó material»
  await processUpdate(press(BROTHER, "rep:n:6")); // Otro
  assert(!buttons().some((b) => b.startsWith("✅ Sin novedad")));
  await processUpdate(press(BROTHER, "rep:n1"));
  assertStringIncludes(lastText(), "nota de voz");
  gemini.replies.push({ transcript: "Se dañó la pulidora del albañil", summary: "Se dañó la pulidora." });
  await processUpdate(say(BROTHER, voice("v1")));
  assertEquals(gemini.calls.at(-1)!.body.contents[0].parts[1].inline_data.mime_type, "audio/ogg");

  // Para mañana (jue 29): tareas 00 y 04, más «Decisión de Carlos» y «Otro».
  assertEquals(buttons().filter((b) => b.includes("|rep:m:")).map((b) => b.split("|")[1]), [
    "rep:m:00",
    "rep:m:04",
    "rep:m:d",
    "rep:m:o",
  ]);
  await processUpdate(press(BROTHER, "rep:m:d"));
  await processUpdate(press(BROTHER, "rep:m1"));

  const preview = lastText();
  for (
    const line of [
      "REPORTE – mié 28 oct",
      "Se hizo hoy: 03 terminada, 04 avanzó",
      "Avance del objetivo semanal: 1 de 7 tareas",
      "Compras: Cemento gris 50 kg en Ferretería El Maestro, $32.000 · Caja menor: $68.000",
      "¿Llegó lo esperado hoy?: no: Viga instalada y puntales retirados",
      "Agua (Triple A): Llamé, sin fecha",
      "Novedades: Faltó material, Se dañó la pulidora.",
      "Para mañana se necesita: Decisión de Carlos",
    ]
  ) assertStringIncludes(preview, line);
  assertEquals(rowsOf("Reportes").length, 0); // nada escrito todavía

  await processUpdate(press(BROTHER, "rep:ok"));
  const [row] = rowsOf("Reportes");
  assertEquals(row.fecha, "2026-10-28");
  assertEquals(row.hora, "17:00");
  assertEquals(row.reportado_por, "Hermano");
  assertEquals([row.tareas_terminadas, row.tareas_avanzadas], ["03", "04"]);
  assertEquals(row.avance_objetivo_pct, 14);
  assertEquals([row.llego_esperado, row.no_llego], ["", "Viga instalada y puntales retirados"]);
  assertEquals([row.novedades, row.novedades_detalle], ["Faltó material", "Se dañó la pulidora."]);
  assertEquals(row.saldo_caja_menor, 68000);
  assertStringIncludes(String(row.texto_reporte), "Agua (Triple A): Llamé, sin fecha");
  assertEquals([task("03").estado, task("04").estado], ["terminada", "en curso"]);
  assertEquals([beam().llego, beam().confirmado_por], ["no", "Hermano"]);
  assertStringIncludes(lastTo(CARLOS), "Tu hermano guardó el reporte:");
  assertEquals((tables.sesiones ?? []).length, 0);
});

Deno.test("reporte en texto libre: pregunta, Gemini lo estructura y se corrige una sección", async () => {
  await resetSheet();
  clearSent();
  await processUpdate(say(BROTHER, { text: "hola" }));
  assertEquals(lastText(), "¿Es el reporte de hoy?");
  await processUpdate(press(BROTHER, "rep:lib:0"));
  assertEquals(lastText(), "Listo, no lo tomo como reporte.");

  await processUpdate(say(BROTHER, { text: "Hoy quedó instalada la viga y llegó. Mañana Carlos decide la ventana." }));
  gemini.replies.push({
    tasks: [{ id: "03", status: "terminada" }, { id: "99", status: "avanzó" }], // 99 no existe: se ignora
    expected: [{ item: "Viga instalada y puntales retirados", arrived: true }],
    water: null,
    water_detail: null,
    news: ["Sin novedad"],
    news_detail: null,
    tomorrow: ["d"],
    tomorrow_detail: "Definir la ventana",
  });
  await processUpdate(press(BROTHER, "rep:lib:1"));
  const schema = gemini.calls.at(-1)!.body.generationConfig.responseFormat.text.schema;
  assertEquals(schema.properties.tasks.items.properties.id.enum.length, 10);
  assertStringIncludes(lastText(), "Se hizo hoy: 03 terminada");
  assertStringIncludes(lastText(), "¿Llegó lo esperado hoy?: sí");
  assertStringIncludes(lastText(), "Agua (Triple A): sin dato");
  assertStringIncludes(lastText(), "Para mañana se necesita: Decisión de Carlos, Definir la ventana");

  await processUpdate(press(BROTHER, "rep:fix"));
  await processUpdate(press(BROTHER, "rep:fx:agua"));
  await processUpdate(press(BROTHER, "rep:w:0"));
  assertStringIncludes(lastText(), "Agua (Triple A): Sin novedad"); // vuelve directo a la vista previa

  await processUpdate(press(BROTHER, "rep:ok"));
  assertEquals(rowsOf("Reportes").length, 1);
  assertEquals(task("03").estado, "terminada");
  assertEquals(beam().llego, "sí");
});

Deno.test("Carlos también puede reportar en su privado (para probar sin el hermano)", async () => {
  await resetSheet();
  clearSent();
  await processUpdate(message(CARLOS, { text: "/reporte" }));
  await processUpdate(tap(CARLOS, "rep:t1"));
  await processUpdate(tap(CARLOS, "rep:c1"));
  await processUpdate(tap(CARLOS, "rep:e:0:1"));
  await processUpdate(tap(CARLOS, "rep:e1"));
  await processUpdate(tap(CARLOS, "rep:w:0"));
  await processUpdate(tap(CARLOS, "rep:n:0"));
  await processUpdate(tap(CARLOS, "rep:n1"));
  await processUpdate(tap(CARLOS, "rep:m1"));
  await processUpdate(tap(CARLOS, "rep:ok"));
  const [row] = rowsOf("Reportes");
  assertEquals([row.reportado_por, row.llego_esperado, row.para_manana], [
    "Carlos",
    "Viga instalada y puntales retirados",
    "nada",
  ]);
  // En su privado no se manda copia a sí mismo.
  assert(!sent.some((e) => String(e.params.text ?? "").includes("guardó el reporte")));
});

Deno.test("la factura de «Agregar compra» puede llegar por el tema Gastos y vuelve al reporte", async () => {
  await resetSheet();
  clearSent();
  await processUpdate(say(BROTHER, { text: "/reporte" }));
  await processUpdate(press(BROTHER, "rep:t1"));
  await processUpdate(press(BROTHER, "rep:c"));
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
  // El reporte sigue en su tema, con la compra.
  assertStringIncludes(lastTo(GROUP, REPORTS_TOPIC), "Compras de hoy:</b> Brocha en Homecenter, $12.000");
  assertEquals(tables.sesiones[0].flujo, "reporte");

  // Un comando que no existe no se toma como reporte.
  clearSent();
  await processUpdate(press(BROTHER, "rep:x"));
  await processUpdate(say(BROTHER, { text: "/pago" }));
  assert(!sent.some((e) => e.params.text === "¿Es el reporte de hoy?"));
});
