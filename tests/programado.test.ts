// Fase 6: avisos programados con la fecha simulada (lunes, diario, festivo y cierre del sábado).
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.19";
import { CARLOS, clearSent, clock, drive, GROUP, REPORTS_TOPIC, resetSheet, rowsOf, sent, sheet } from "./_world.ts";
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

Deno.test("diario: lo esperado sin confirmar (una vez) y el recordatorio del reporte", async () => {
  await resetSheet();
  clearSent();
  on("2026-10-28");
  const result = await runJob("diario");
  assertEquals(result.enviado, ["aviso de lo esperado sin confirmar (1)", "recordatorio del reporte"]);
  const alert = "⚠️ <b>Lo esperado de hoy no está confirmado</b>\n• Viga instalada y puntales retirados (tarea 03)\n" +
    "Confírmalo en el reporte del día, en «¿Llegó lo esperado hoy?».";
  assertEquals(toCarlos(), [alert]);
  assertEquals(toTopic(), [
    alert,
    "⏰ Todavía no hay reporte de hoy. Manda por aquí las notas del día (voz o texto) y toca «Cerrar el reporte».",
  ]);
  assertEquals(rowsOf("Esperado").find((r) => r.fecha === "2026-10-28")!.aviso_enviado, "sí");

  // Otra vez el mismo día, ya con el reporte: no repite el aviso ni el recordatorio.
  clearSent();
  addRow("Reportes", { fecha: "2026-10-28", hora: "16:30", reportado_por: "Hermano" });
  assertEquals((await runJob("diario")).enviado, ["nada: lo esperado está confirmado y ya hay reporte"]);
  assertEquals(messages().length, 0);
});

Deno.test("diario: lo que se marcó «no llegó» no se vuelve a avisar; festivo y domingo, sin avisos", async () => {
  await resetSheet();
  clearSent();
  setCell("Esperado", (r) => r.fecha === "2026-10-28", "llego", "no");
  on("2026-10-28");
  assertEquals((await runJob("diario")).enviado, ["recordatorio del reporte"]);

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
