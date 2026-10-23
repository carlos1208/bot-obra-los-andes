// Enrutador: botón tocado → sesión activa → comando → contenido.

import { leerSesion } from "../_shared/db.ts";
import { comandoDe, imagenDe, responderCallback } from "../_shared/telegram.ts";
import * as antes from "./agentes/antes.ts";
import { estado } from "./agentes/estado.ts";
import type { Ctx } from "./contexto.ts";

const AYUDA = [
  "Por ahora entiendo:",
  "/estado – semana de obra, tareas de hoy y disponible",
  "/antes – subir fotos ANTES (Carlos)",
].join("\n");

export async function enrutar(ctx: Ctx): Promise<void> {
  // 1. Botones
  if (ctx.callback) {
    const data = ctx.callback.data ?? "";
    if (data.startsWith("ant:")) return await antes.alTocar(ctx);
    await responderCallback(ctx.callback.id, "Ese botón ya no está activo.");
    return;
  }

  const mensaje = ctx.mensaje!;
  const comando = comandoDe(mensaje.text ?? mensaje.caption);

  // 2. Comandos (cortan cualquier flujo en curso)
  if (comando === "estado") return await estado(ctx);
  if (comando === "antes") return await antes.iniciar(ctx);
  if (comando === "start" || comando === "ayuda") {
    if (ctx.lugar === "privado") await ctx.responder(AYUDA);
    return;
  }

  // 3. Sesión activa
  const sesion = await leerSesion(ctx.chatId, ctx.userId);
  if (sesion?.flujo === antes.FLUJO) return await antes.continuar(ctx, sesion);

  // 4. Contenido
  const imagenes = ctx.mensajes.map(imagenDe).filter((i) => i !== null);
  if (imagenes.length && (ctx.lugar === "fotos" || ctx.lugar === "privado")) {
    if (ctx.rol === "carlos") return await antes.iniciar(ctx, imagenes);
    if (ctx.lugar === "fotos") {
      await ctx.responder("Las fotos DESPUÉS todavía no las recibo. Te aviso cuando estén listas.");
    }
    return;
  }

  // En el grupo, la conversación normal no es para el bot (por ahora).
  if (ctx.lugar === "privado") await ctx.responder(AYUDA);
}
