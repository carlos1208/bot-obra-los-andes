// Flujo completo con Telegram, Google y Postgres simulados: autorización, duplicados,
// /estado en un tema y fotos ANTES (una por una y en álbum).
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.19";

import {
  BROTHER,
  CARLOS,
  clearSent,
  drive,
  GROUP,
  lastText,
  message,
  photo,
  PHOTOS_TOPIC,
  processUpdate,
  REPORTS_TOPIC,
  sent,
  sheet,
  tables,
  tap,
} from "./_world.ts";

// --- Pruebas ----------------------------------------------------------------------
Deno.test("ignora a desconocidos sin responder ni guardar nada", async () => {
  clearSent();
  await processUpdate(message(333, { text: "/estado" }));
  await processUpdate(message(CARLOS, { text: "/estado" }, -100123)); // otro grupo
  assertEquals(sent.length, 0);
  assertEquals((tables.updates_procesados ?? []).length, 1); // solo el de Carlos en otro grupo pasó el filtro de remitente
});

Deno.test("update repetido se procesa una sola vez", async () => {
  clearSent();
  const u = message(CARLOS, { text: "/estado" });
  await processUpdate(u);
  await processUpdate(u);
  assertEquals(sent.filter((e) => e.method === "sendMessage").length, 1);
});

Deno.test("sin HERMANO_TG_ID el bot sigue funcionando para Carlos", async () => {
  clearSent();
  Deno.env.delete("HERMANO_TG_ID");
  try {
    await processUpdate(message(CARLOS, { text: "/estado" }));
    await processUpdate(message(BROTHER, { text: "/estado" }, GROUP, REPORTS_TOPIC));
  } finally {
    Deno.env.set("HERMANO_TG_ID", String(BROTHER));
  }
  const replies = sent.filter((e) => e.method === "sendMessage");
  assertEquals(replies.length, 1);
  assertEquals(replies[0].params.chat_id, CARLOS);
  assertStringIncludes(String(replies[0].params.text), "ESTADO");
});

Deno.test("/estado en el tema Reportes responde en el mismo tema y sin dinero", async () => {
  clearSent();
  await processUpdate(message(BROTHER, { text: "/estado@ObraBot" }, GROUP, REPORTS_TOPIC));
  const reply = sent.find((e) => e.method === "sendMessage")!;
  assertEquals(reply.params.chat_id, GROUP);
  assertEquals(reply.params.message_thread_id, REPORTS_TOPIC);
  assertStringIncludes(String(reply.params.text), "ESTADO");
  assert(!String(reply.params.text).includes("12 M"));
});

Deno.test("fotos ANTES: catálogo, una por una y «Listo»", async () => {
  clearSent();
  await processUpdate(message(CARLOS, { text: "/antes" }, GROUP, PHOTOS_TOPIC));
  const catalog = sent.find((e) => e.method === "sendMessage")!;
  assertStringIncludes(String(catalog.params.text), "Faltan 24 de 24.");
  const keyboard = (catalog.params.reply_markup as { inline_keyboard: { callback_data: string }[][] }).inline_keyboard;
  assertEquals(keyboard[0][0].callback_data, "ant:c:F01");
  assertEquals(keyboard.at(-2)![0].callback_data, "ant:p:1"); // página siguiente

  await processUpdate(tap(CARLOS, "ant:c:F01", GROUP, PHOTOS_TOPIC));
  assertStringIncludes(lastText(), "Mándame de 1 a 3 fotos.");

  await processUpdate(message(CARLOS, photo("a1"), GROUP, PHOTOS_TOPIC));
  assertStringIncludes(lastText(), "Guardé 1 foto de F01. Van 1 de 3.");
  await processUpdate(tap(CARLOS, "ant:fin", GROUP, PHOTOS_TOPIC));
  assertStringIncludes(lastText(), "Listo: F01 · Muro cocina–sala completo quedó con 1 foto ANTES.");

  const folder = drive.find((f) => f.name === "F01 Muro cocina–sala completo")!;
  assertEquals(folder.parents, [drive.find((f) => f.name === "Antes y después")!.id]);
  const file = drive.find((f) => f.parents.includes(folder.id))!;
  assertEquals(file.name.replace(/\d{4}-\d{2}-\d{2}/, "FECHA"), "ANTES FECHA (1).jpg");
  assertEquals(file.appProperties, {
    codigo: "F01",
    nombre: "Muro cocina–sala completo",
    tipo: "antes",
    tareas: "02,09",
    hitos: "H1,H2",
    subido_por: "carlos",
    estado: "sin después",
  });
  assertEquals((tables.sesiones ?? []).length, 0);

  // F01 ya no aparece en el catálogo.
  clearSent();
  await processUpdate(message(CARLOS, { text: "/antes" }));
  assertStringIncludes(lastText(), "Faltan 23 de 24.");
});

Deno.test("fotos ANTES: álbum que llega antes de elegir el código", async () => {
  // La prueba anterior dejó abierto el catálogo en el privado: «Cancelar» lo cierra.
  await processUpdate(tap(CARLOS, "ant:x"));
  assertEquals((tables.sesiones ?? []).length, 0);
  clearSent();
  const group = { media_group_id: "alb1" };
  await Promise.all([
    processUpdate(message(CARLOS, { ...photo("b1"), ...group })),
    processUpdate(message(CARLOS, { ...photo("b2"), ...group })),
  ]);
  assertStringIncludes(lastText(), "¿Qué es esta foto?");
  await processUpdate(tap(CARLOS, "que:a"));
  assertStringIncludes(lastText(), "Recibí 2 fotos. ¿De cuál foto ANTES son?");
  assertEquals((tables.album_buffer ?? []).length, 0);

  await processUpdate(tap(CARLOS, "ant:c:F09"));
  const folder = drive.find((f) => f.name === "F09 Techo de la cocina y del área de labores")!;
  const names = drive.filter((f) => f.parents.includes(folder.id)).map((f) => f.name.replace(/\d{4}-\d{2}-\d{2}/, "F"));
  assertEquals(names, ["ANTES F (1).jpg", "ANTES F (2).jpg"]);
  // F09 no tiene hitos: la propiedad no se guarda vacía.
  assertEquals("hitos" in drive.find((f) => f.parents.includes(folder.id))!.appProperties!, false);
  assertStringIncludes(lastText(), "Van 2 de 3");
  // La tercera cierra sola.
  await processUpdate(message(CARLOS, photo("b3")));
  assertStringIncludes(lastText(), "quedó con 3 fotos ANTES");
});

Deno.test("el /antes del hermano es por imprevisto y un error no le muestra detalles técnicos", async () => {
  clearSent();
  await processUpdate(message(BROTHER, { text: "/antes" }, GROUP, PHOTOS_TOPIC));
  assertStringIncludes(lastText(), "ANTES por imprevisto o que falta. Escribe un nombre corto");
  await processUpdate(tap(BROTHER, "ant:x", GROUP, PHOTOS_TOPIC));

  clearSent();
  const errorsBefore = (tables.errores ?? []).length;
  const saved = sheet.Config;
  sheet.Config = [["clave", "valor"]]; // Config rota: falta fecha_inicio
  const consoleError = console.error;
  console.error = () => {}; // el error es esperado: que no ensucie la salida de las pruebas
  try {
    await processUpdate(message(BROTHER, { text: "/estado" }, GROUP, REPORTS_TOPIC));
  } finally {
    console.error = consoleError;
    sheet.Config = saved;
  }
  const toBrother = sent.find((e) => e.params.chat_id === GROUP)!;
  assertEquals(toBrother.params.text, "No pude procesar eso. Ya le avisé a Carlos.");
  const toCarlos = sent.find((e) => e.params.chat_id === CARLOS)!;
  assertStringIncludes(String(toCarlos.params.text), "⚠️ Error");
  assertStringIncludes(String(toCarlos.params.text), "fecha_inicio");
  assertEquals(tables.errores.length, errorsBefore + 1);
});
