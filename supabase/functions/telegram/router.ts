// Enrutador: botón tocado → comando → sesión activa → contenido.

import { readSession } from "../_shared/db.ts";
import { answerCallback, commandOf, imageOf } from "../_shared/telegram.ts";
import * as beforePhotos from "./agents/before_photos.ts";
import { status } from "./agents/status.ts";
import type { Context } from "./context.ts";

const HELP = [
  "Por ahora entiendo:",
  "/estado – semana de obra, tareas de hoy y disponible",
  "/antes – subir fotos ANTES (Carlos)",
].join("\n");

export async function route(ctx: Context): Promise<void> {
  // 1. Botones
  if (ctx.callback) {
    const data = ctx.callback.data ?? "";
    if (data.startsWith("ant:")) return await beforePhotos.onButton(ctx);
    await answerCallback(ctx.callback.id, "Ese botón ya no está activo.");
    return;
  }

  const message = ctx.message!;
  const command = commandOf(message.text ?? message.caption);

  // 2. Comandos (cortan cualquier flujo en curso)
  if (command === "estado") return await status(ctx);
  if (command === "antes") return await beforePhotos.start(ctx);
  if (command === "start" || command === "ayuda") {
    if (ctx.place === "private") await ctx.reply(HELP);
    return;
  }

  // 3. Sesión activa
  const session = await readSession(ctx.chatId, ctx.userId);
  if (session?.flujo === beforePhotos.FLOW) return await beforePhotos.resume(ctx, session);

  // 4. Contenido
  const images = ctx.messages.map(imageOf).filter((i) => i !== null);
  if (images.length && (ctx.place === "photos" || ctx.place === "private")) {
    if (ctx.role === "carlos") return await beforePhotos.start(ctx, images);
    if (ctx.place === "photos") {
      await ctx.reply("Las fotos DESPUÉS todavía no las recibo. Te aviso cuando estén listas.");
    }
    return;
  }

  // En el grupo, la conversación normal no es para el bot (por ahora).
  if (ctx.place === "private") await ctx.reply(HELP);
}
