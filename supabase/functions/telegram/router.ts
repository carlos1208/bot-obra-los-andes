// Enrutador: botón tocado → comando → sesión activa en este tema → contenido.
// Si el contenido es ambiguo, pregunta con botones; no adivina. Por privado, un texto o una nota de voz lo
// lee Gemini: pago o reposición de caja menor (Carlos) o pregunta (los dos).

import { deleteSession, readSession, saveSession, type Session } from "../_shared/db.ts";
import {
  answerCallback,
  type Button,
  commandOf,
  editMessageText,
  imageOf,
  invoiceFileOf,
} from "../_shared/telegram.ts";
import * as afterPhotos from "./agents/after_photos.ts";
import * as beforePhotos from "./agents/before_photos.ts";
import * as expenses from "./agents/expenses.ts";
import { interpret } from "./agents/interpret.ts";
import * as milestones from "./agents/milestones.ts";
import * as payments from "./agents/payments.ts";
import * as questions from "./agents/questions.ts";
import * as report from "./agents/report.ts";
import { status } from "./agents/status.ts";
import type { Context } from "./context.ts";
import { button, type FlowBase, isActiveButton, sameThread } from "./ui.ts";

const HELP = [
  "Por ahora entiendo:",
  "/reporte – reporte del día (tema Reportes)",
  "/gasto – registrar una compra (tema Gastos)",
  "/pago – registrar un pago o una reposición de caja menor (Carlos, por privado)",
  "/estado – semana de obra, tareas de hoy y disponible",
  "/antes – subir fotos ANTES (tu hermano: ANTES por imprevisto)",
  "/despues – subir fotos DESPUÉS",
  "/pendientes – pares por validar y por revisar en sitio (Carlos)",
  "«Marcar H1 cumplido» – fecha de cumplido de un hito (Carlos, por privado)",
  "",
  "Por privado también respondo preguntas, en texto o voz: «¿qué toca esta semana?».",
].join("\n");

const EXAMPLE_QUESTION = "«¿qué toca esta semana?»";
const EXAMPLE_PAYMENT = "«le pagué 700 mil al albañil por el H1 por Nequi»";

/** Foto que puede ser varias cosas: en el privado de Carlos, factura o ANTES; del hermano en el tema de fotos,
 * DESPUÉS o ANTES por imprevisto. */
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
    if (data.startsWith("dsp:")) return await afterPhotos.onButton(ctx);
    if (data.startsWith("val:")) return await afterPhotos.onValidation(ctx);
    if (data.startsWith("pag:")) return await payments.onButton(ctx);
    if (data.startsWith("hit:")) return await milestones.onButton(ctx);
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
  if (command === "despues") return await afterPhotos.start(ctx);
  if (command === "pendientes") return await afterPhotos.pending(ctx);
  if (command === "pago") return await payments.start(ctx);
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
    if (session.flujo === afterPhotos.FLOW) return await afterPhotos.resume(ctx, session as never);
    if (session.flujo === payments.FLOW) return await payments.resume(ctx, session as never);
    if (session.flujo === milestones.FLOW) return await milestones.resume(ctx, session as never);
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
    return await askAboutPhoto(ctx, images, [
      button("DESPUÉS", "que:d"),
      button("ANTES por imprevisto", "que:i"),
      button("Cancelar", "que:x"),
    ]);
  }
  if (ctx.place === "reports") {
    if (images.length || invoice) {
      await ctx.reply("Las facturas van en el tema Gastos y las fotos de obra en «Antes y después».");
      return;
    }
    if (message.voice || message.text) return await report.receiveNote(ctx);
    return;
  }
  if (ctx.place === "private") {
    if (invoice && !images.length) return await expenses.receiveInvoice(ctx, invoice); // PDF
    if (images.length) {
      return await askAboutPhoto(ctx, images, [
        button("Factura", "que:f"),
        button("Foto ANTES", "que:a"),
        button("Cancelar", "que:x"),
      ]);
    }
    const code = milestones.milestoneCommand(message.text);
    if (code) return await milestones.start(ctx, code);
    return await privateMessage(ctx);
  }
  // En el resto del grupo, la conversación normal no es para el bot.
}

/** Texto o voz libre por privado: pago o reposición (Carlos) o pregunta (los dos). */
async function privateMessage(ctx: Context): Promise<void> {
  const read = await interpret(ctx);
  if (!read) {
    await ctx.reply(HELP);
    return;
  }
  const { got, wait } = read;
  if (got.kind === "pago" || got.kind === "reposicion") {
    if (ctx.role === "carlos") return await payments.fromMessage(ctx, got, wait);
    await editMessageText(ctx.chatId, wait, "Los pagos los registra Carlos.");
    return;
  }
  if (got.kind === "pregunta") return await questions.answer(ctx, got, wait);
  const options = ctx.role === "carlos"
    ? `hacer una pregunta de la obra (${EXAMPLE_QUESTION}) o registrar un pago (${EXAMPLE_PAYMENT})`
    : `hacer una pregunta de la obra (${EXAMPLE_QUESTION})`;
  await editMessageText(ctx.chatId, wait, `No entendí. Por aquí puedes ${options}.`);
}

async function askAboutPhoto(ctx: Context, images: QuestionData["images"], options: Button[]): Promise<void> {
  const m = await ctx.reply("¿Qué es esta foto?", [options]);
  await saveSession(ctx.chatId, ctx.userId, QUESTION, "elegir", {
    images,
    msg: m.message_id,
    hilo: ctx.threadId ?? null,
  });
}

const CHOICES: Record<string, string> = {
  f: "Factura",
  a: "Foto ANTES",
  d: "DESPUÉS",
  i: "ANTES por imprevisto",
};

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
  await editMessageText(ctx.chatId, cb.message!.message_id, CHOICES[choice] ?? "Cancelado.");
  await deleteSession(ctx.chatId, ctx.userId);
  if (choice === "f") {
    if (images.length > 1) await ctx.reply("Uso la primera foto.");
    return await expenses.receiveInvoice(ctx, images[0]);
  }
  if (choice === "a") return await beforePhotos.start(ctx, images);
  if (choice === "d") return await afterPhotos.start(ctx, images);
  if (choice === "i") return await beforePhotos.startException(ctx, images);
}
