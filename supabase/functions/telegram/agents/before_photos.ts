// Fotos ANTES de Carlos con el catálogo F01–F24. Solo Drive: no escribe en la hoja.
// Cada par vive en «Antes y después/<código> <nombre>/» y su estado en appProperties.

import { CATALOG, type CatalogPhoto, catalogPhoto, pairFolderName, photoFileName } from "../../_shared/catalog.ts";
import { deleteSession, readSession, saveSession, type Session } from "../../_shared/db.ts";
import {
  appProperties,
  findOrCreateFolder,
  FOLDERS,
  listFiles,
  quote,
  topFolder,
  uploadFile,
} from "../../_shared/drive.ts";
import { escapeHtml, todayISO } from "../../_shared/format.ts";
import {
  answerCallback,
  downloadFile,
  editKeyboard,
  editMessageText,
  imageOf,
  type Keyboard,
  MAX_FILE_BYTES,
  type ReceivedImage,
} from "../../_shared/telegram.ts";
import type { Context } from "../context.ts";

/** Valor de sesiones.flujo para este flujo. */
export const FLOW = "antes";
const MAX_PHOTOS = 3;
const PAGE_SIZE = 8;
const IS_BEFORE = "appProperties has { key='tipo' and value='antes' }";

interface FlowData {
  pending?: ReceivedImage[];
  code?: string;
}

async function codesWithBefore(): Promise<Set<string>> {
  const files = await listFiles(IS_BEFORE);
  return new Set(files.map((f) => f.appProperties?.codigo ?? "").filter(Boolean));
}

async function missingPhotos(): Promise<CatalogPhoto[]> {
  const done = await codesWithBefore();
  return CATALOG.filter((f) => !done.has(f.codigo));
}

function catalogKeyboard(missing: CatalogPhoto[], page: number): Keyboard {
  const from = page * PAGE_SIZE;
  const rows: Keyboard = missing
    .slice(from, from + PAGE_SIZE)
    .map((f) => [{ text: `${f.codigo} · ${f.nombre}`, callback_data: `ant:c:${f.codigo}` }]);
  const nav = [];
  if (page > 0) nav.push({ text: "◀ Anteriores", callback_data: `ant:p:${page - 1}` });
  if (from + PAGE_SIZE < missing.length) nav.push({ text: "Siguientes ▶", callback_data: `ant:p:${page + 1}` });
  if (nav.length) rows.push(nav);
  rows.push([{ text: "Cancelar", callback_data: "ant:x" }]);
  return rows;
}

const DONE_KEYBOARD: Keyboard = [[{ text: "Listo", callback_data: "ant:fin" }]];

function imagesOf(ctx: Context): ReceivedImage[] {
  return ctx.messages.map(imageOf).filter((i): i is ReceivedImage => i !== null);
}

/** /antes, o fotos que llegan sin haber elegido el código. */
export async function start(ctx: Context, pending: ReceivedImage[] = []): Promise<void> {
  if (ctx.role !== "carlos") {
    await ctx.reply("Las fotos ANTES las sube Carlos. Si falta una o hay un imprevisto, avísale.");
    return;
  }
  const missing = await missingPhotos();
  if (!missing.length) {
    await deleteSession(ctx.chatId, ctx.userId);
    await ctx.reply(`Ya están todas las fotos ANTES del catálogo (${CATALOG.length}).`);
    return;
  }
  await saveSession(ctx.chatId, ctx.userId, FLOW, "choose", { pending });
  const n = pending.length;
  const question = n
    ? `Recibí ${n} foto${n > 1 ? "s" : ""}. ¿De cuál foto ANTES ${n > 1 ? "son" : "es"}?`
    : "¿Qué foto ANTES vas a subir?";
  await ctx.reply(`${question}\nFaltan ${missing.length} de ${CATALOG.length}.`, catalogKeyboard(missing, 0));
}

/** Botones «ant:…». */
export async function onButton(ctx: Context): Promise<void> {
  const cb = ctx.callback!;
  const message = cb.message!;
  const session = await readSession<FlowData>(ctx.chatId, ctx.userId);
  if (!session || session.flujo !== FLOW) {
    await answerCallback(cb.id, "Esto ya venció. Escribe /antes.");
    return;
  }
  const [, action, value] = (cb.data ?? "").split(":");

  if (action === "p") {
    await editKeyboard(ctx.chatId, message.message_id, catalogKeyboard(await missingPhotos(), Number(value) || 0));
    await answerCallback(cb.id);
    return;
  }
  if (action === "x") {
    await deleteSession(ctx.chatId, ctx.userId);
    await editMessageText(ctx.chatId, message.message_id, "Cancelado. No guardé nada nuevo.");
    await answerCallback(cb.id);
    return;
  }
  if (action === "fin") {
    await answerCallback(cb.id);
    await editKeyboard(ctx.chatId, message.message_id);
    await finish(ctx, session.datos.code);
    return;
  }
  if (action === "c") {
    const photo = catalogPhoto(value);
    if (!photo || (await codesWithBefore()).has(photo.codigo)) {
      await answerCallback(cb.id, "Esa ya tiene foto ANTES.");
      return;
    }
    await answerCallback(cb.id);
    await editMessageText(
      ctx.chatId,
      message.message_id,
      `<b>${photo.codigo} · ${escapeHtml(photo.nombre)}</b>\nEncuadre: ${escapeHtml(photo.encuadre)}`,
    );
    const pending = session.datos.pending ?? [];
    await saveSession(ctx.chatId, ctx.userId, FLOW, "photos", { code: photo.codigo });
    if (pending.length) {
      await receivePhotos(ctx, photo, pending);
    } else {
      await ctx.reply(`Mándame de 1 a ${MAX_PHOTOS} fotos.`);
    }
    return;
  }
  await answerCallback(cb.id);
}

/** Mensaje mientras hay una sesión de fotos ANTES abierta. */
export async function resume(ctx: Context, session: Session<FlowData>): Promise<void> {
  const images = imagesOf(ctx);
  if (session.paso === "choose") {
    if (images.length) {
      const pending = [...(session.datos.pending ?? []), ...images];
      await saveSession(ctx.chatId, ctx.userId, FLOW, "choose", { pending });
      const many = pending.length > 1;
      await ctx.reply(
        `Tengo ${pending.length} foto${many ? "s" : ""}. Elige arriba de cuál foto ANTES ${many ? "son" : "es"}.`,
      );
    } else {
      await ctx.reply("Elige arriba qué foto ANTES vas a subir, o toca «Cancelar».");
    }
    return;
  }
  const photo = catalogPhoto(session.datos.code ?? "");
  if (!photo) {
    await deleteSession(ctx.chatId, ctx.userId);
    await ctx.reply("Perdí el código de la foto. Escribe /antes para empezar de nuevo.");
    return;
  }
  if (!images.length) {
    await ctx.reply(`Estoy esperando las fotos de ${photo.codigo}. Mándalas o toca «Listo».`, DONE_KEYBOARD);
    return;
  }
  await receivePhotos(ctx, photo, images);
}

async function pairFolder(photo: CatalogPhoto) {
  const root = await topFolder(FOLDERS.beforeAfter);
  return await findOrCreateFolder(
    pairFolderName(photo.codigo, photo.nombre),
    root.id,
    appProperties({ codigo: photo.codigo, nombre: photo.nombre }),
  );
}

async function receivePhotos(ctx: Context, photo: CatalogPhoto, images: ReceivedImage[]): Promise<void> {
  const folder = await pairFolder(photo);
  const existing = (await listFiles(`${quote(folder.id)} in parents and ${IS_BEFORE}`)).length;
  const room = Math.max(0, MAX_PHOTOS - existing);
  const batch = images.slice(0, room);
  const notes: string[] = [];
  if (images.length > room) {
    notes.push(`Solo guardo ${MAX_PHOTOS} por foto ANTES. No guardé ${images.length - room}.`);
  }

  const date = todayISO();
  let n = existing;
  for (const img of batch) {
    if (img.size && img.size > MAX_FILE_BYTES) {
      notes.push("Una foto pesa más de 20 MB. Mándala como foto, no como archivo.");
      continue;
    }
    const { bytes } = await downloadFile(img.fileId);
    n++;
    await uploadFile({
      name: photoFileName("ANTES", date, n, img.extension),
      parent: folder.id,
      mimeType: img.mime,
      bytes,
      appProperties: appProperties({
        codigo: photo.codigo,
        nombre: photo.nombre,
        tipo: "antes",
        tareas: photo.tareas.join(","),
        hitos: photo.hitos.join(","),
        subido_por: ctx.role,
        estado: "sin después",
      }),
    });
  }

  const added = n - existing;
  if (n >= MAX_PHOTOS) {
    if (notes.length) await ctx.reply(notes.join("\n"));
    await finish(ctx, photo.codigo);
    return;
  }
  await saveSession(ctx.chatId, ctx.userId, FLOW, "photos", { code: photo.codigo });
  const summary = added
    ? `Guardé ${added} foto${
      added > 1 ? "s" : ""
    } de ${photo.codigo}. Van ${n} de ${MAX_PHOTOS}. Manda otra o toca «Listo».`
    : `No guardé fotos de ${photo.codigo}. Mándalas de nuevo o toca «Listo».`;
  await ctx.reply([...notes, summary].join("\n"), DONE_KEYBOARD);
}

async function finish(ctx: Context, code?: string): Promise<void> {
  await deleteSession(ctx.chatId, ctx.userId);
  const photo = catalogPhoto(code ?? "");
  if (!photo) {
    await ctx.reply("Listo.");
    return;
  }
  const folder = await pairFolder(photo);
  const total = (await listFiles(`${quote(folder.id)} in parents and ${IS_BEFORE}`)).length;
  if (!total) {
    await ctx.reply(`${photo.codigo} quedó sin fotos ANTES. Escribe /antes cuando las tengas.`);
    return;
  }
  const link = folder.webViewLink ? ` <a href="${folder.webViewLink}">Ver en Drive</a>` : "";
  await ctx.reply(
    `Listo: ${photo.codigo} · ${escapeHtml(photo.nombre)} quedó con ${total} foto${
      total > 1 ? "s" : ""
    } ANTES.${link}\nPara la siguiente, escribe /antes.`,
  );
}
