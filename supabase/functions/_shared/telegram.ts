// Cliente mínimo de Telegram Bot API (versión 10.3).

import { env } from "./env.ts";

export const MAX_FILE_BYTES = 20 * 1024 * 1024; // getFile: hasta 20 MB

export interface User {
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

export interface PhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface Document {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

export interface Message {
  message_id: number;
  message_thread_id?: number;
  is_topic_message?: boolean;
  from?: User;
  chat: Chat;
  date: number;
  text?: string;
  caption?: string;
  media_group_id?: string;
  photo?: PhotoSize[];
  document?: Document;
  voice?: Document & { duration: number };
  reply_to_message?: Message & { forum_topic_created?: { name: string } };
  forum_topic_created?: { name: string };
}

export interface CallbackQuery {
  id: string;
  from: User;
  message?: Message;
  data?: string;
}

export interface Update {
  update_id: number;
  message?: Message;
  callback_query?: CallbackQuery;
}

export interface Button {
  text: string;
  callback_data: string;
}

export type Keyboard = Button[][];

/** Si Telegram pide esperar (429 con retry_after) hasta este tiempo, se espera y se reintenta. */
export const telegramRetry = { maxWaitSeconds: 30, attempts: 2 };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Hace la llamada y, con «Too Many Requests: retry after N», espera N segundos y la repite. */
async function call<T>(method: string, init: () => RequestInit): Promise<T> {
  for (let attempt = 0;; attempt++) {
    const r = await fetch(`https://api.telegram.org/bot${env("TELEGRAM_BOT_TOKEN")}/${method}`, init());
    const data = await r.json();
    if (data.ok) return data.result as T;
    const wait = data.parameters?.retry_after;
    if (
      r.status === 429 && typeof wait === "number" && wait <= telegramRetry.maxWaitSeconds &&
      attempt < telegramRetry.attempts
    ) {
      console.log(`Telegram ${method}: 429, espero ${wait} s`);
      await sleep(wait * 1000 + 100);
      continue;
    }
    throw new Error(`Telegram ${method}: ${data.description ?? r.status}`);
  }
}

export function tg<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  return call<T>(method, () => ({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  }));
}

/** Llamada con multipart/form-data (para subir archivos). */
function tgForm<T = unknown>(method: string, form: FormData): Promise<T> {
  return call<T>(method, () => ({ method: "POST", body: form }));
}

export interface Target {
  chatId: number;
  threadId?: number;
}

export async function sendMessage(target: Target, text: string, keyboard?: Keyboard): Promise<Message> {
  return await tg<Message>("sendMessage", {
    chat_id: target.chatId,
    message_thread_id: target.threadId,
    text,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined,
  });
}

export async function editMessageText(chatId: number, messageId: number, text: string, keyboard?: Keyboard) {
  return await tg("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined,
  });
}

export async function editKeyboard(chatId: number, messageId: number, keyboard?: Keyboard) {
  return await tg("editMessageReplyMarkup", {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: { inline_keyboard: keyboard ?? [] },
  });
}

/** Responde al toque de un botón. Si ya venció (p. ej. en un reintento), no pasa nada. */
export async function answerCallback(id: string, text?: string): Promise<void> {
  await tg("answerCallbackQuery", { callback_query_id: id, text }).catch(() => {});
}

/**
 * Manda fotos subiendo sus bytes: una con sendPhoto; varias como álbum (sendMediaGroup, de 2 a 10 por álbum).
 */
export async function sendPhotos(target: Target, photos: { bytes: Uint8Array<ArrayBuffer>; mime: string }[]) {
  for (let i = 0; i < photos.length; i += 10) {
    const chunk = photos.slice(i, i + 10);
    const form = new FormData();
    form.set("chat_id", String(target.chatId));
    if (target.threadId) form.set("message_thread_id", String(target.threadId));
    const file = (p: { bytes: Uint8Array<ArrayBuffer>; mime: string }) => new Blob([p.bytes], { type: p.mime });
    if (chunk.length === 1) {
      form.set("photo", file(chunk[0]), "foto.jpg");
      await tgForm("sendPhoto", form);
      continue;
    }
    form.set("media", JSON.stringify(chunk.map((_, j) => ({ type: "photo", media: `attach://p${j}` }))));
    chunk.forEach((p, j) => form.set(`p${j}`, file(p), `p${j}.jpg`));
    await tgForm("sendMediaGroup", form);
  }
}

/** Descarga un archivo de Telegram (máximo 20 MB). */
export async function downloadFile(fileId: string): Promise<{ bytes: Uint8Array<ArrayBuffer>; path: string }> {
  const file = await tg<{ file_path?: string; file_size?: number }>("getFile", { file_id: fileId });
  if (!file.file_path) throw new Error("Telegram no entregó la ruta del archivo");
  const r = await fetch(`https://api.telegram.org/file/bot${env("TELEGRAM_BOT_TOKEN")}/${file.file_path}`);
  if (!r.ok) throw new Error(`Descarga de Telegram ${r.status}`);
  return { bytes: new Uint8Array(await r.arrayBuffer()), path: file.file_path };
}

/** Imagen de un mensaje: la foto en su mayor tamaño o un archivo de imagen. */
export interface ReceivedImage {
  fileId: string;
  size?: number;
  mime: string;
  extension: string;
}

export function imageOf(m: Message): ReceivedImage | null {
  if (m.photo?.length) {
    const largest = m.photo[m.photo.length - 1];
    return { fileId: largest.file_id, size: largest.file_size, mime: "image/jpeg", extension: "jpg" };
  }
  if (m.document?.mime_type?.startsWith("image/")) {
    const ext = m.document.file_name?.split(".").pop()?.toLowerCase() ||
      m.document.mime_type.split("/")[1] || "jpg";
    return {
      fileId: m.document.file_id,
      size: m.document.file_size,
      mime: m.document.mime_type,
      extension: ext === "jpeg" ? "jpg" : ext,
    };
  }
  return null;
}

/** Factura que llega como foto, archivo de imagen o PDF. */
export function invoiceFileOf(m: Message): ReceivedImage | null {
  const image = imageOf(m);
  if (image) return image;
  if (m.document?.mime_type === "application/pdf") {
    return { fileId: m.document.file_id, size: m.document.file_size, mime: "application/pdf", extension: "pdf" };
  }
  return null;
}

/** Comando del texto («/estado@MiBot hola» -> "estado"). */
export function commandOf(text?: string): string | null {
  const m = text?.trim().match(/^\/([a-záéíóúñ_]+)(?:@\w+)?(?:\s|$)/i);
  return m ? m[1].toLowerCase() : null;
}
