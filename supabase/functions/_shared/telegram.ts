// Cliente mínimo de Telegram Bot API (versión 10.3).

import { env } from "./env.ts";

export const LIMITE_ARCHIVO = 20 * 1024 * 1024; // getFile: hasta 20 MB

export interface Usuario {
  id: number;
  first_name: string;
  username?: string;
}

export interface Chat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
  is_forum?: boolean;
}

export interface TamanoFoto {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface Documento {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

export interface Mensaje {
  message_id: number;
  message_thread_id?: number;
  is_topic_message?: boolean;
  from?: Usuario;
  chat: Chat;
  date: number;
  text?: string;
  caption?: string;
  media_group_id?: string;
  photo?: TamanoFoto[];
  document?: Documento;
  voice?: Documento & { duration: number };
  reply_to_message?: Mensaje & { forum_topic_created?: { name: string } };
  forum_topic_created?: { name: string };
}

export interface Callback {
  id: string;
  from: Usuario;
  message?: Mensaje;
  data?: string;
}

export interface Update {
  update_id: number;
  message?: Mensaje;
  callback_query?: Callback;
}

export interface Boton {
  text: string;
  callback_data: string;
}

export type Teclado = Boton[][];

export async function tg<T = unknown>(metodo: string, params: Record<string, unknown> = {}): Promise<T> {
  const r = await fetch(`https://api.telegram.org/bot${env("TELEGRAM_BOT_TOKEN")}/${metodo}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const datos = await r.json();
  if (!datos.ok) throw new Error(`Telegram ${metodo}: ${datos.description ?? r.status}`);
  return datos.result as T;
}

export interface Destino {
  chatId: number;
  threadId?: number;
}

export async function enviar(destino: Destino, texto: string, teclado?: Teclado): Promise<Mensaje> {
  return await tg<Mensaje>("sendMessage", {
    chat_id: destino.chatId,
    message_thread_id: destino.threadId,
    text: texto,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    reply_markup: teclado ? { inline_keyboard: teclado } : undefined,
  });
}

export async function editarTexto(chatId: number, messageId: number, texto: string, teclado?: Teclado) {
  return await tg("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text: texto,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    reply_markup: teclado ? { inline_keyboard: teclado } : undefined,
  });
}

export async function editarTeclado(chatId: number, messageId: number, teclado?: Teclado) {
  return await tg("editMessageReplyMarkup", {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: { inline_keyboard: teclado ?? [] },
  });
}

export async function responderCallback(id: string, texto?: string) {
  return await tg("answerCallbackQuery", { callback_query_id: id, text: texto });
}

/** Descarga un archivo de Telegram (máximo 20 MB). */
export async function descargar(fileId: string): Promise<{ bytes: Uint8Array<ArrayBuffer>; ruta: string }> {
  const archivo = await tg<{ file_path?: string; file_size?: number }>("getFile", { file_id: fileId });
  if (!archivo.file_path) throw new Error("Telegram no entregó la ruta del archivo");
  const r = await fetch(`https://api.telegram.org/file/bot${env("TELEGRAM_BOT_TOKEN")}/${archivo.file_path}`);
  if (!r.ok) throw new Error(`Descarga de Telegram ${r.status}`);
  return { bytes: new Uint8Array(await r.arrayBuffer()), ruta: archivo.file_path };
}

/** Imagen de un mensaje: la foto en su mayor tamaño o un archivo de imagen. */
export interface ImagenRecibida {
  fileId: string;
  tamano?: number;
  mime: string;
  extension: string;
}

export function imagenDe(m: Mensaje): ImagenRecibida | null {
  if (m.photo?.length) {
    const mayor = m.photo[m.photo.length - 1];
    return { fileId: mayor.file_id, tamano: mayor.file_size, mime: "image/jpeg", extension: "jpg" };
  }
  if (m.document?.mime_type?.startsWith("image/")) {
    const ext = m.document.file_name?.split(".").pop()?.toLowerCase() ||
      m.document.mime_type.split("/")[1] || "jpg";
    return {
      fileId: m.document.file_id,
      tamano: m.document.file_size,
      mime: m.document.mime_type,
      extension: ext === "jpeg" ? "jpg" : ext,
    };
  }
  return null;
}

/** Comando del texto («/estado@MiBot hola» -> "estado"). */
export function comandoDe(texto?: string): string | null {
  const m = texto?.trim().match(/^\/([a-záéíóúñ_]+)(?:@\w+)?(?:\s|$)/i);
  return m ? m[1].toLowerCase() : null;
}
