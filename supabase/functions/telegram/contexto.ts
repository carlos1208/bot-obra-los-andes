// Quién escribe, desde dónde y cómo responderle en el mismo chat y tema.

import { envNumero } from "../_shared/env.ts";
import type { Config } from "../_shared/obra.ts";
import { type Callback, enviar, type Mensaje, type Teclado, type Update } from "../_shared/telegram.ts";

export type Rol = "carlos" | "hermano";
export type Lugar = "privado" | "reportes" | "fotos" | "gastos" | "grupo";

export interface Ctx {
  update: Update;
  rol: Rol;
  userId: number;
  chatId: number;
  threadId?: number;
  lugar: Lugar;
  /** Mensaje recibido. En un álbum, el primero. */
  mensaje?: Mensaje;
  /** Todos los mensajes del álbum (o solo el mensaje). */
  mensajes: Mensaje[];
  callback?: Callback;
  responder(texto: string, teclado?: Teclado): Promise<Mensaje>;
}

export function rolDe(userId: number | undefined): Rol | null {
  if (userId === undefined) return null;
  if (userId === envNumero("CARLOS_TG_ID")) return "carlos";
  if (userId === envNumero("HERMANO_TG_ID")) return "hermano";
  return null;
}

function lugarDe(m: Mensaje): Lugar | null {
  if (m.chat.type === "private") return "privado";
  if (m.chat.id !== envNumero("GROUP_CHAT_ID")) return null;
  switch (m.message_thread_id) {
    case envNumero("TOPIC_REPORTES_ID"):
      return "reportes";
    case envNumero("TOPIC_FOTOS_ID"):
      return "fotos";
    case envNumero("TOPIC_GASTOS_ID"):
      return "gastos";
    default:
      return "grupo";
  }
}

/**
 * Arma el contexto. Devuelve null si el mensaje no es de Carlos o de su hermano,
 * o si viene de un chat que no es el grupo de la obra ni un privado: se ignora sin responder.
 */
export function crearContexto(update: Update, mensajes: Mensaje[] = []): Ctx | null {
  const callback = update.callback_query;
  const mensaje = callback?.message ?? mensajes[0] ?? update.message;
  const usuario = callback?.from ?? mensaje?.from;
  if (!mensaje || !usuario) return null;
  const rol = rolDe(usuario.id);
  const lugar = lugarDe(mensaje);
  if (!rol || !lugar) return null;
  // En privado, cada uno solo habla con el bot desde su propio chat.
  if (lugar === "privado" && mensaje.chat.id !== usuario.id) return null;

  const destino = { chatId: mensaje.chat.id, threadId: lugar === "privado" ? undefined : mensaje.message_thread_id };
  return {
    update,
    rol,
    userId: usuario.id,
    chatId: destino.chatId,
    threadId: destino.threadId,
    lugar,
    mensaje: callback ? undefined : mensaje,
    mensajes: callback ? [] : (mensajes.length ? mensajes : [mensaje]),
    callback,
    responder: (texto, teclado) => enviar(destino, texto, teclado),
  };
}

/** Dinero: solo Carlos en su privado, salvo que Config.hermano_ve_dinero = sí. */
export function puedeVerDinero(ctx: Ctx, cfg: Config): boolean {
  if (cfg.hermano_ve_dinero) return true;
  return ctx.rol === "carlos" && ctx.lugar === "privado";
}
