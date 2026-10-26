// Antes y después de punta a punta: ANTES de Carlos (catálogo y «Otro nombre»), ANTES por imprevisto del
// hermano con aprobación, DESPUÉS con la foto de referencia, validación por privado, /pendientes y el reporte.
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.19";
import {
  BROTHER,
  buttons,
  CARLOS,
  clearSent,
  clock,
  drive,
  gemini,
  GROUP,
  lastText,
  lastTo,
  message,
  photo,
  PHOTOS_TOPIC,
  processUpdate,
  REPORTS_TOPIC,
  resetSheet,
  sent,
  tables,
  tap,
  timing,
} from "./_world.ts";

clock.now = () => new Date("2026-10-28T22:00:00Z"); // mié 28 oct, 17:00 en Bogotá
timing.retryWaitMs = 0;

const inPhotos = (from: number, extra: Record<string, unknown>) => message(from, extra, GROUP, PHOTOS_TOPIC);
const pressPhotos = (from: number, data: string) => tap(from, data, GROUP, PHOTOS_TOPIC);
const folder = (prefix: string) => drive.find((f) => f.name.startsWith(prefix) && !f.trashed)!;
const filesIn = (prefix: string, kind: string) =>
  drive.filter((f) => f.parents.includes(folder(prefix).id) && f.appProperties?.tipo === kind);
const reset = async () => {
  drive.length = 0;
  (tables.sesiones ?? []).length = 0;
  await resetSheet();
  clearSent();
};

async function beforeF01() {
  await processUpdate(inPhotos(CARLOS, { text: "/antes" }));
  await processUpdate(pressPhotos(CARLOS, "ant:c:F01"));
  await processUpdate(inPhotos(CARLOS, photo("a1")));
  await processUpdate(pressPhotos(CARLOS, "ant:fin"));
}

Deno.test("F01: DESPUÉS con la foto de referencia, validación por privado y sus tres botones", async () => {
  await reset();
  await beforeF01();

  // El hermano elige el ANTES (📅: ligado a una tarea de esta semana) y recibe la foto de referencia.
  await processUpdate(inPhotos(BROTHER, { text: "/despues" }));
  assert(buttons().includes("📅 F01 · Muro cocina–sala completo|dsp:c:F01"));
  clearSent();
  await processUpdate(pressPhotos(BROTHER, "dsp:c:F01"));
  const reference = sent.find((e) => e.method === "sendPhoto")!;
  assertEquals([reference.params.chat_id, reference.params.message_thread_id, reference.params.files], [
    String(GROUP),
    String(PHOTOS_TOPIC),
    1,
  ]);
  assertStringIncludes(lastText(), "Encuadre: Desde la sala");
  assertStringIncludes(lastText(), "Manda la foto DESPUÉS desde el mismo ángulo que esta.");

  await processUpdate(inPhotos(BROTHER, photo("b1")));
  const [after] = filesIn("F01", "después");
  assertEquals(after.name, "DESPUÉS 2026-10-28 (1).jpg");
  assertEquals(after.appProperties!.codigo, "F01");
  assertEquals(after.appProperties!.subido_por, "hermano");
  assertEquals(filesIn("F01", "antes")[0].appProperties!.estado, "por validar");
  assertEquals(after.appProperties!.estado, "por validar");
  assertStringIncludes(
    lastTo(GROUP, PHOTOS_TOPIC),
    "Listo: F01 · Muro cocina–sala completo quedó por validar. Le avisé a Carlos.",
  );

  // Carlos recibe el par como álbum (ANTES y DESPUÉS) y los datos para validar.
  const album = sent.find((e) => e.method === "sendMediaGroup")!;
  assertEquals([album.params.chat_id, album.params.files], [String(CARLOS), 2]);
  const validation = lastTo(CARLOS);
  assertStringIncludes(validation, "Validar cierre: F01 · Muro cocina–sala completo");
  assertStringIncludes(validation, "Tarea 02: Demoler parte alta del muro cocina-sala");
  assertStringIncludes(validation, "Hito H1 – Cocina abierta: Muro demolido, viga instalada");
  assertEquals(buttons(), [
    "Cierre validado|val:ok:F01",
    "No cuadra, reviso en sitio|val:sitio:F01",
    "Pedir otra foto|val:otra:F01",
  ]);

  // /pendientes
  await processUpdate(message(CARLOS, { text: "/pendientes" }));
  assertStringIncludes(lastText(), "<b>Por validar</b>\n• F01 Muro cocina–sala completo (tareas 02, 09; H1, H2)");
  assertEquals(buttons(), ["Ver F01 · Muro cocina–sala completo|val:ver:F01"]);
  await processUpdate(message(BROTHER, { text: "/pendientes" }, GROUP, PHOTOS_TOPIC));
  assertEquals(lastText(), "/pendientes es para Carlos.");

  // «Pedir otra foto»: el DESPUÉS queda descartado y el hermano recibe el pedido con su botón.
  await processUpdate(tap(CARLOS, "val:ver:F01"));
  await processUpdate(tap(CARLOS, "val:otra:F01"));
  assertEquals(after.appProperties!.estado, "descartada");
  assertEquals(filesIn("F01", "antes")[0].appProperties!.estado, "sin después");
  assertEquals(lastTo(GROUP, PHOTOS_TOPIC), "Carlos pide otra foto DESPUÉS de F01 · Muro cocina–sala completo.");
  assertEquals(buttons(), ["Subir DESPUÉS|dsp:c:F01"]);
  await processUpdate(pressPhotos(BROTHER, "dsp:c:F01"));
  await processUpdate(inPhotos(BROTHER, photo("b2")));
  assertEquals(filesIn("F01", "después").filter((f) => f.appProperties!.estado === "por validar").length, 1);

  // «No cuadra, reviso en sitio» y luego «Cierre validado» desde /pendientes.
  await processUpdate(tap(CARLOS, "val:sitio:F01"));
  assertEquals(filesIn("F01", "antes")[0].appProperties!.estado, "revisar en sitio");
  await processUpdate(message(CARLOS, { text: "/pendientes" }));
  assertStringIncludes(lastText(), "<b>Revisar en sitio</b>\n• F01");
  await processUpdate(tap(CARLOS, "val:ver:F01"));
  await processUpdate(tap(CARLOS, "val:ok:F01"));
  assertEquals(filesIn("F01", "antes")[0].appProperties!.estado, "validado");
  assertStringIncludes(lastText(), "✅ Cierre validado: F01 · Muro cocina–sala completo.");
  await processUpdate(message(CARLOS, { text: "/pendientes" }));
  assertEquals(lastText(), "No hay pares por validar ni por revisar en sitio.");
  await processUpdate(tap(BROTHER, "val:ok:F01", GROUP, PHOTOS_TOPIC));
  assertEquals(sent.filter((e) => e.method === "answerCallbackQuery").at(-1)!.params.text, "Esto lo valida Carlos.");
});

Deno.test("ANTES por imprevisto del hermano: Carlos aprueba con tareas (propuestas y cambiadas) o rechaza", async () => {
  await reset();
  // Foto del hermano en el tema: pregunta qué es.
  await processUpdate(inPhotos(BROTHER, photo("p1")));
  assertEquals(buttons(), ["DESPUÉS|que:d", "ANTES por imprevisto|que:i", "Cancelar|que:x"]);
  await processUpdate(pressPhotos(BROTHER, "que:i"));
  await processUpdate(inPhotos(BROTHER, { text: "Tubo roto en el baño social" }));
  assertStringIncludes(lastText(), "¿Por qué hace falta?");
  await processUpdate(inPhotos(BROTHER, { text: "Apareció al demoler" }));
  assertStringIncludes(lastText(), "Guardé 1 foto de F25. Van 1 de 3.");
  await processUpdate(pressPhotos(BROTHER, "ant:fin"));
  assertStringIncludes(
    lastTo(GROUP, PHOTOS_TOPIC),
    "F25 · Tubo roto en el baño social quedó esperando la aprobación de Carlos.",
  );
  const [before] = filesIn("F25", "antes");
  assertEquals(before.appProperties, {
    codigo: "F25",
    nombre: "Tubo roto en el baño social",
    tipo: "antes",
    subido_por: "hermano",
    estado: "por aprobar",
    motivo: "Apareció al demoler",
  });
  assert(sent.some((e) => e.method === "sendPhoto" && e.params.chat_id === String(CARLOS)));
  assertStringIncludes(
    lastTo(CARLOS),
    "Tu hermano subió un ANTES por imprevisto:\n<b>F25 · Tubo roto en el baño social</b>",
  );
  assertEquals(buttons(), ["Aprobar|ant:a:F25", "Rechazar|ant:r:F25"]);

  // Mientras no se apruebe, no sale para subir DESPUÉS.
  await processUpdate(inPhotos(BROTHER, { text: "/despues" }));
  assertEquals(lastText(), "No hay fotos ANTES esperando su DESPUÉS.");

  // Carlos aprueba: Gemini propone (lo que no existe se descarta) y Carlos cambia por números.
  gemini.replies.push({ tasks: ["23", "99"] });
  await processUpdate(tap(CARLOS, "ant:a:F25"));
  assertStringIncludes(gemini.calls.at(-1)!.body.contents[0].parts[1].text, "Motivo: Apareció al demoler");
  assertStringIncludes(
    lastText(),
    "Tareas para «Tubo roto en el baño social»:\n• 23 Redes hidrosanitarias del baño social",
  );
  await processUpdate(tap(CARLOS, "ant:t:otra"));
  await processUpdate(message(CARLOS, { text: "23- 27" }));
  assertStringIncludes(lastText(), "• 27 ");
  await processUpdate(tap(CARLOS, "ant:t:ok"));
  assertEquals(before.appProperties!.tareas, "23,27");
  assertEquals(before.appProperties!.hitos, "H3"); // de la columna hito de Tareas
  assertEquals(before.appProperties!.estado, "sin después");
  assertStringIncludes(lastTo(GROUP, PHOTOS_TOPIC), "Carlos aprobó el ANTES F25 · Tubo roto en el baño social.");

  // Otro que Carlos rechaza: queda en la papelera.
  await processUpdate(inPhotos(BROTHER, { text: "/antes" }));
  await processUpdate(inPhotos(BROTHER, { text: "Grieta" }));
  await processUpdate(inPhotos(BROTHER, { text: "Se vio hoy" }));
  await processUpdate(inPhotos(BROTHER, photo("p2")));
  await processUpdate(pressPhotos(BROTHER, "ant:fin"));
  await processUpdate(tap(CARLOS, "ant:r:F26"));
  assert(drive.find((f) => f.name === "F26 Grieta")!.trashed);
  assertEquals(lastTo(GROUP, PHOTOS_TOPIC), "Carlos no aprobó el ANTES «Grieta».");
  await processUpdate(tap(CARLOS, "ant:a:F26"));
  assertEquals(sent.filter((e) => e.method === "answerCallbackQuery").at(-1)!.params.text, "Ese ANTES ya se resolvió.");
});

Deno.test("«Otro nombre» de Carlos: Gemini propone las tareas, Carlos confirma y sube la foto", async () => {
  await reset();
  gemini.replies.push({ tasks: ["22", "27"] });
  await processUpdate(message(CARLOS, { text: "/antes" }));
  assert(buttons().includes("Otro nombre|ant:o"));
  await processUpdate(tap(CARLOS, "ant:o"));
  await processUpdate(message(CARLOS, { text: "Puerta del baño social" }));
  assertStringIncludes(lastText(), "• 22 Demoler baño social");
  await processUpdate(tap(CARLOS, "ant:t:ok"));
  await processUpdate(message(CARLOS, photo("o1")));
  await processUpdate(tap(CARLOS, "ant:fin"));
  const [before] = filesIn("F25", "antes");
  assertEquals(folder("F25").name, "F25 Puerta del baño social");
  assertEquals([before.appProperties!.tareas, before.appProperties!.hitos, before.appProperties!.estado], [
    "22,27",
    "H3",
    "sin después",
  ]);
  assertStringIncludes(lastText(), "Listo: F25 · Puerta del baño social quedó con 1 foto ANTES.");
});

Deno.test("el reporte nombra los pares del día y avisa si una tarea terminada no tiene DESPUÉS", async () => {
  await reset();
  await beforeF01();
  const report = async () => {
    gemini.replies.push({ transcript: "Muro listo", summary: "Muro listo." }, {
      summary: "• Muro listo.",
      warnings: [],
    });
    await processUpdate(message(BROTHER, { text: "Muro listo" }, GROUP, REPORTS_TOPIC));
    await processUpdate(tap(BROTHER, "rep:q:1", GROUP, REPORTS_TOPIC));
    await processUpdate(tap(BROTHER, "rep:cerrar", GROUP, REPORTS_TOPIC));
    await processUpdate(message(BROTHER, { text: "2" }, GROUP, REPORTS_TOPIC));
    await processUpdate(tap(BROTHER, "rep:t:ok", GROUP, REPORTS_TOPIC));
    await processUpdate(tap(BROTHER, "rep:e:0:1", GROUP, REPORTS_TOPIC));
    await processUpdate(tap(BROTHER, "rep:e:fin", GROUP, REPORTS_TOPIC));
    return lastText();
  };
  const without = await report();
  assertStringIncludes(
    without,
    "<b>Fotos</b>\nSin pares nuevos hoy.\n⚠️ 02 está terminada y F01 Muro cocina–sala completo no tiene foto DESPUÉS.",
  );
  await processUpdate(tap(BROTHER, "rep:x", GROUP, REPORTS_TOPIC));

  await processUpdate(inPhotos(BROTHER, { text: "/despues" }));
  await processUpdate(pressPhotos(BROTHER, "dsp:c:F01"));
  await processUpdate(inPhotos(BROTHER, photo("b9")));
  const withPair = await report();
  assertStringIncludes(
    withPair,
    "• F01 Muro cocina–sala completo: antes y después (tareas 02, 09; H1, H2), por validar",
  );
  assert(!withPair.includes("no tiene foto DESPUÉS"));
  await processUpdate(tap(BROTHER, "rep:ok", GROUP, REPORTS_TOPIC));
});
