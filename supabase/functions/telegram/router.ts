// Enrutador: botón tocado → comando → sesión activa en este tema → contenido.
// Si el contenido es ambiguo, pregunta con botones; no adivina.

import { deleteSession, readSession, saveSession, type Session } from "../_shared/db.ts";
import { answerCallback, commandOf, editMessageText, imageOf, invoiceFileOf } from "../_shared/telegram.ts";
import * as beforePhotos from "./agents/before_photos.ts";
import * as expenses from "./agents/expenses.ts";
import * as report from "./agents/report.ts";
import { status } from "./agents/status.ts";
import type { Context } from "./context.ts";
import { button, type FlowBase, isActiveButton, sameThread } from "./ui.ts";

const HELP = [
  "Por ahora entiendo:",
  "/reporte – reporte del día (tema Reportes)",
  "/gasto – registrar una compra (tema Gastos)",
  "/estado – semana de obra, tareas de hoy y disponible",
  "/antes – subir fotos ANTES (Carlos)",
].join("\n");

/** Foto en el privado de Carlos: puede ser una factura o una foto ANTES. */
const QUESTION = "pregunta";
interface QuestionData extends FlowBase {
  images: NonNullable<ReturnType<typeof imageOf>>[];
}

export async function route(ctx: Context): Promise<void> {
  // 1. Botones
  if (ctx.callback) {
    const data = ctx.callback.data ?? "";
    if (data.startsWith("ant:")) return await beforePhotos.onButton(ctx);
    if (data.startsWith("gas:")) return await expenses.onButton(ctx);
    if (data.startsWith("rep:")) return await report.onButton(ctx);
    if (data.startsWith("que:")) return await answerQuestion(ctx);
    await answerCallback(ctx.callback.id, "Ese botón ya no está activo.");
    return;
  }

  const message = ctx.message!;
  const command = commandOf(message.text ?? message.caption);

  // 2. Comandos (cortan el flujo en curso)
  if (command === "estado") return await status(ctx);
  if (command === "antes") return await beforePhotos.start(ctx);
  if (command === "reporte") return await report.start(ctx);
  if (command === "gasto") return await expenses.start(ctx);
  if (command) {
    // /start, /ayuda y los comandos que todavía no existen.
    if (ctx.place === "private") await ctx.reply(HELP);
    return;
  }

  // 3. Sesión activa en este mismo tema
  const session = await readSession<FlowBase>(ctx.chatId, ctx.userId);
  if (session && sameThread(session, ctx)) {
    if (session.flujo === beforePhotos.FLOW) return await beforePhotos.resume(ctx, session as never);
    if (session.flujo === expenses.FLOW) return await expenses.resume(ctx, session as never);
    if (session.flujo === report.FLOW) return await report.resume(ctx, session as never);
    if (session.flujo === QUESTION) {
      await ctx.reply("Elige arriba qué es la foto.");
      return;
    }
  }
  // Un gasto a mitad del reporte (o de «Agregar compra») vuelve al reporte al terminar.
  const back = session?.flujo === report.FLOW
    ? { flujo: session.flujo, paso: session.paso, datos: session.datos as Record<string, unknown> }
    : session?.flujo === expenses.FLOW
    ? (session.datos as { back?: expenses.ReturnTo }).back
    : undefined;

  // 4. Contenido
  const invoice = ctx.messages.map(invoiceFileOf).find((f) => f !== null);
  const images = ctx.messages.map(imageOf).filter((i) => i !== null);

  if (ctx.place === "expenses") {
    if (invoice) return await expenses.receiveInvoice(ctx, invoice, back);
    await ctx.reply("Para registrar una compra manda la foto o el PDF de la factura, o escribe /gasto.");
    return;
  }
  if (ctx.place === "photos") {
    if (!images.length) return;
    if (ctx.role === "carlos") return await beforePhotos.start(ctx, images);
    await ctx.reply("Las fotos DESPUÉS todavía no las recibo. Te aviso cuando estén listas.");
    return;
  }
  if (ctx.place === "reports") {
    if (images.length || invoice) {
      await ctx.reply("Las facturas van en el tema Gastos y las fotos de obra en «Antes y después».");
      return;
    }
    if (message.voice || message.text) return await report.offerFreeReport(ctx);
    return;
  }
  if (ctx.place === "private") {
    if (invoice && !images.length) return await expenses.receiveInvoice(ctx, invoice); // PDF
    if (images.length) return await askAboutPhoto(ctx, images);
    await ctx.reply(HELP);
  }
  // En el resto del grupo, la conversación normal no es para el bot.
}

async function askAboutPhoto(ctx: Context, images: QuestionData["images"]): Promise<void> {
  const m = await ctx.reply("¿Qué es esta foto?", [[
    button("Factura", "que:f"),
    button("Foto ANTES", "que:a"),
    button("Cancelar", "que:x"),
  ]]);
  await saveSession(ctx.chatId, ctx.userId, QUESTION, "elegir", { images, msg: m.message_id, hilo: null });
}

async function answerQuestion(ctx: Context): Promise<void> {
  const cb = ctx.callback!;
  const session = await readSession<QuestionData>(ctx.chatId, ctx.userId);
  if (!session || session.flujo !== QUESTION || !isActiveButton(session as Session<FlowBase>, ctx)) {
    await answerCallback(cb.id, "Ese botón ya no está activo.");
    return;
  }
  await answerCallback(cb.id);
  const { images } = session.datos;
  const choice = (cb.data ?? "").split(":")[1];
  const label = choice === "f" ? "Factura" : choice === "a" ? "Foto ANTES" : "Cancelado.";
  await editMessageText(ctx.chatId, cb.message!.message_id, label);
  await deleteSession(ctx.chatId, ctx.userId);
  if (choice === "f") {
    if (images.length > 1) await ctx.reply("Uso la primera foto.");
    return await expenses.receiveInvoice(ctx, images[0]);
  }
  if (choice === "a") return await beforePhotos.start(ctx, images);
}
