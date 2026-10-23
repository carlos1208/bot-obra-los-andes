// Quién escribe, desde dónde y cómo responderle en el mismo chat y tema.

import { envNumber } from "../_shared/env.ts";
import type { Config } from "../_shared/site.ts";
import { type CallbackQuery, type Keyboard, type Message, sendMessage, type Update } from "../_shared/telegram.ts";

export type Role = "carlos" | "hermano";
export type Place = "private" | "reports" | "photos" | "expenses" | "group";

export interface Context {
  update: Update;
  role: Role;
  userId: number;
  chatId: number;
  threadId?: number;
  place: Place;
  /** Mensaje recibido. En un álbum, el primero. */
  message?: Message;
  /** Todos los mensajes del álbum (o solo el mensaje). */
  messages: Message[];
  callback?: CallbackQuery;
  reply(text: string, keyboard?: Keyboard): Promise<Message>;
}

export function roleOf(userId: number | undefined): Role | null {
  if (userId === undefined) return null;
  if (userId === envNumber("CARLOS_TG_ID")) return "carlos";
  if (userId === envNumber("HERMANO_TG_ID")) return "hermano";
  return null;
}

function placeOf(m: Message): Place | null {
  if (m.chat.type === "private") return "private";
  if (m.chat.id !== envNumber("GROUP_CHAT_ID")) return null;
  switch (m.message_thread_id) {
    case envNumber("TOPIC_REPORTES_ID"):
      return "reports";
    case envNumber("TOPIC_FOTOS_ID"):
      return "photos";
    case envNumber("TOPIC_GASTOS_ID"):
      return "expenses";
    default:
      return "group";
  }
}

/**
 * Arma el contexto. Devuelve null si el mensaje no es de Carlos o de su hermano,
 * o si viene de un chat que no es el grupo de la obra ni un privado: se ignora sin responder.
 */
export function createContext(update: Update, album: Message[] = []): Context | null {
  const callback = update.callback_query;
  const message = callback?.message ?? album[0] ?? update.message;
  const user = callback?.from ?? message?.from;
  if (!message || !user) return null;
  const role = roleOf(user.id);
  const place = placeOf(message);
  if (!role || !place) return null;
  // En privado, cada uno solo habla con el bot desde su propio chat.
  if (place === "private" && message.chat.id !== user.id) return null;

  const target = { chatId: message.chat.id, threadId: place === "private" ? undefined : message.message_thread_id };
  return {
    update,
    role,
    userId: user.id,
    chatId: target.chatId,
    threadId: target.threadId,
    place,
    message: callback ? undefined : message,
    messages: callback ? [] : (album.length ? album : [message]),
    callback,
    reply: (text, keyboard) => sendMessage(target, text, keyboard),
  };
}

/** Dinero: solo Carlos en su privado, salvo que Config.hermano_ve_dinero = sí. */
export function canSeeMoney(ctx: Context, cfg: Config): boolean {
  if (cfg.hermano_ve_dinero) return true;
  return ctx.role === "carlos" && ctx.place === "private";
}
