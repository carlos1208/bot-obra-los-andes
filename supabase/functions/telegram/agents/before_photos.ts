// Fotos ANTES. Solo Drive: no escribe en la hoja. Cada par vive en «Antes y después/<código> <nombre>/»
// y su estado en appProperties.
// - Carlos: catálogo de fotos ANTES (las que faltan) o «Otro nombre»: Gemini propone las tareas y Carlos confirma.
// - Hermano (excepción): falta un ANTES o hay un imprevisto. Nombre corto, motivo y fotos; Carlos aprueba o
//   rechaza por privado. Al aprobar, Gemini propone las tareas y Carlos confirma.

import { CATALOG, type CatalogPhoto, catalogPhoto, pairFolderName, photoFileName } from "../../_shared/catalog.ts";
import { deleteSession, readSession, saveSession, type Session } from "../../_shared/db.ts";
import {
  appProperties,
  findOrCreateFolder,
  FOLDERS,
  listFiles,
  quote,
  topFolder,
  trashFile,
  uploadFile,
} from "../../_shared/drive.ts";
import { envNumber } from "../../_shared/env.ts";
import { proposeTasks } from "../../_shared/extractors.ts";
import { escapeHtml, normalize, todayISO } from "../../_shared/format.ts";
import { IS_BEFORE, listPairs, nextCode, photoBytes, STATE, updatePair } from "../../_shared/pairs.ts";
import { readTabs } from "../../_shared/sheets.ts";
import { parseTaskIds, readTasks, type Task } from "../../_shared/site.ts";
import {
  answerCallback,
  downloadFile,
  editKeyboard,
  editMessageText,
  imageOf,
  type Keyboard,
  MAX_FILE_BYTES,
  type ReceivedImage,
  sendMessage,
  sendPhotos,
} from "../../_shared/telegram.ts";
import type { Context } from "../context.ts";
import { button, type FlowBase } from "../ui.ts";

/** Valor de sesiones.flujo para este flujo. */
export const FLOW = "antes";
const MAX_PHOTOS = 3;
const PAGE_SIZE = 8;

/** Lo que se guarda con cada foto ANTES (del catálogo o con nombre libre). */
interface PhotoSpec {
  code: string;
  name: string;
  framing: string;
  tasks: string[];
  hitos: string[];
  state: string;
  reason: string;
}

/** Foto con nombre libre mientras se confirman sus tareas. Con `code`, es el ANTES del hermano que se aprueba. */
interface Draft {
  name: string;
  reason: string;
  tasks: string[];
  code?: string;
}

interface FlowData extends FlowBase {
  pending?: ReceivedImage[];
  spec?: PhotoSpec;
  draft?: Draft;
}

const catalogSpec = (c: CatalogPhoto): PhotoSpec => ({
  code: c.codigo,
  name: c.nombre,
  framing: c.encuadre,
  tasks: c.tareas,
  hitos: c.hitos,
  state: STATE.noAfter,
  reason: "",
});

async function save(ctx: Context, step: string, data: FlowData): Promise<void> {
  await saveSession(ctx.chatId, ctx.userId, FLOW, step, { ...data, hilo: ctx.threadId ?? null });
}

async function missingPhotos(): Promise<CatalogPhoto[]> {
  const codes = new Set((await listPairs()).map((p) => p.code));
  return CATALOG.filter((f) => !codes.has(f.codigo));
}

function catalogKeyboard(missing: CatalogPhoto[], page: number): Keyboard {
  const from = page * PAGE_SIZE;
  const rows: Keyboard = missing
    .slice(from, from + PAGE_SIZE)
    .map((f) => [button(`${f.codigo} · ${f.nombre}`, `ant:c:${f.codigo}`)]);
  const nav = [];
  if (page > 0) nav.push(button("◀ Anteriores", `ant:p:${page - 1}`));
  if (from + PAGE_SIZE < missing.length) nav.push(button("Siguientes ▶", `ant:p:${page + 1}`));
  if (nav.length) rows.push(nav);
  rows.push([button("Otro nombre", "ant:o"), button("Cancelar", "ant:x")]);
  return rows;
}

const DONE_KEYBOARD: Keyboard = [[button("Listo", "ant:fin")]];

function imagesOf(ctx: Context): ReceivedImage[] {
  return ctx.messages.map(imageOf).filter((i): i is ReceivedImage => i !== null);
}

const photosTopic = () => ({ chatId: envNumber("GROUP_CHAT_ID"), threadId: envNumber("TOPIC_FOTOS_ID") });

/** /antes, o fotos que llegan sin haber elegido el código. */
export async function start(ctx: Context, pending: ReceivedImage[] = []): Promise<void> {
  if (ctx.role !== "carlos") return await startException(ctx, pending);
  const missing = await missingPhotos();
  await save(ctx, "choose", { pending });
  const n = pending.length;
  const question = n
    ? `Recibí ${n} foto${n > 1 ? "s" : ""}. ¿De cuál foto ANTES ${n > 1 ? "son" : "es"}?`
    : "¿Qué foto ANTES vas a subir?";
  const left = missing.length
    ? `Faltan ${missing.length} de ${CATALOG.length}.`
    : `Ya están todas las del catálogo (${CATALOG.length}). Para otra, toca «Otro nombre».`;
  await ctx.reply(`${question}\n${left}`, catalogKeyboard(missing, 0));
}

/** ANTES del hermano: falta uno o hay un imprevisto. */
export async function startException(ctx: Context, pending: ReceivedImage[] = []): Promise<void> {
  await save(ctx, "nombre", { pending });
  await ctx.reply(
    "ANTES por imprevisto o que falta. Escribe un nombre corto para la foto (por ejemplo «Tubo roto en el baño social»).",
    [[button("Cancelar", "ant:x")]],
  );
}

// --- Botones «ant:…» -------------------------------------------------------------

export async function onButton(ctx: Context): Promise<void> {
  const cb = ctx.callback!;
  const message = cb.message!;
  const [, action, value] = (cb.data ?? "").split(":");
  // Aprobar / Rechazar el ANTES del hermano: Carlos lo toca en su privado, sin sesión abierta.
  if (action === "a" || action === "r") return await answerApproval(ctx, action, value);

  const session = await readSession<FlowData>(ctx.chatId, ctx.userId);
  if (!session || session.flujo !== FLOW) {
    await answerCallback(cb.id, "Esto ya venció. Escribe /antes.");
    return;
  }
  const data = session.datos;

  if (action === "x") {
    await deleteSession(ctx.chatId, ctx.userId);
    await editMessageText(ctx.chatId, message.message_id, "Cancelado. No guardé nada nuevo.");
    await answerCallback(cb.id);
    return;
  }
  if (action === "p") {
    await editKeyboard(ctx.chatId, message.message_id, catalogKeyboard(await missingPhotos(), Number(value) || 0));
    await answerCallback(cb.id);
    return;
  }
  if (action === "fin") {
    await answerCallback(cb.id);
    await editKeyboard(ctx.chatId, message.message_id);
    if (data.spec) await finish(ctx, data.spec);
    else await deleteSession(ctx.chatId, ctx.userId);
    return;
  }
  if (action === "o" && session.paso === "choose") {
    await answerCallback(cb.id);
    await editMessageText(
      ctx.chatId,
      message.message_id,
      "Escribe un nombre corto para la foto (por ejemplo «Puerta del baño social»).",
    );
    await save(ctx, "nombre", data);
    return;
  }
  if (action === "t" && session.paso === "tareas" && data.draft) {
    await answerCallback(cb.id);
    await editKeyboard(ctx.chatId, message.message_id);
    if (value === "ok") return await confirmDraft(ctx, data, data.draft);
    await save(ctx, "numeros", data);
    await ctx.reply("Escribe los números de las tareas separados por guion (por ejemplo 22-23), o 0 si ninguna.");
    return;
  }
  if (action === "c" && session.paso === "choose") {
    const photo = catalogPhoto(value);
    if (!photo || !(await missingPhotos()).some((f) => f.codigo === photo.codigo)) {
      await answerCallback(cb.id, "Esa ya tiene foto ANTES.");
      return;
    }
    await answerCallback(cb.id);
    await editMessageText(
      ctx.chatId,
      message.message_id,
      `<b>${photo.codigo} · ${escapeHtml(photo.nombre)}</b>\nEncuadre: ${escapeHtml(photo.encuadre)}`,
    );
    return await startPhotos(ctx, catalogSpec(photo), data.pending ?? []);
  }
  await answerCallback(cb.id, "Ese botón ya no está activo.");
}

// --- Mensajes con el flujo abierto -------------------------------------------------

export async function resume(ctx: Context, session: Session<FlowData>): Promise<void> {
  const data = session.datos;
  const images = imagesOf(ctx);
  const text = ctx.message?.text?.trim() ?? "";
  switch (session.paso) {
    case "choose": {
      if (images.length) {
        const pending = [...(data.pending ?? []), ...images];
        await save(ctx, "choose", { pending });
        const many = pending.length > 1;
        await ctx.reply(
          `Tengo ${pending.length} foto${many ? "s" : ""}. Elige arriba de cuál foto ANTES ${many ? "son" : "es"}.`,
        );
      } else {
        await ctx.reply("Elige arriba qué foto ANTES vas a subir, o toca «Cancelar».");
      }
      return;
    }
    case "nombre": {
      if (images.length) return await keepPending(ctx, session, images, "Ahora escribe el nombre corto de la foto.");
      if (!text) {
        await ctx.reply("Escribe el nombre corto de la foto en texto.");
        return;
      }
      if (ctx.role === "carlos") return await askTasks(ctx, data, { name: text, reason: "", tasks: [] });
      await save(ctx, "motivo", { ...data, draft: { name: text, reason: "", tasks: [] } });
      await ctx.reply("¿Por qué hace falta? Escribe el motivo en pocas palabras.");
      return;
    }
    case "motivo": {
      if (images.length) return await keepPending(ctx, session, images, "Ahora escribe el motivo.");
      if (!text || !data.draft) {
        await ctx.reply("Escribe el motivo en texto.");
        return;
      }
      const spec: PhotoSpec = {
        code: nextCode(await listPairs()),
        name: data.draft.name,
        framing: "",
        tasks: [],
        hitos: [],
        state: STATE.pendingApproval,
        reason: text,
      };
      return await startPhotos(ctx, spec, data.pending ?? []);
    }
    case "numeros": {
      if (!data.draft) break;
      const { Tareas } = await readTabs(["Tareas"]);
      const tasks = readTasks(Tareas);
      if (normalize(text) === "0") return await showDraft(ctx, data, { ...data.draft, tasks: [] }, tasks);
      const { ids, unknown } = parseTaskIds(text, tasks.map((t) => t.id));
      if (!ids.length || unknown.length) {
        const which = unknown.length ? ` No encontré: ${escapeHtml(unknown.join(", "))}.` : "";
        await ctx.reply(`No entendí los números.${which} Escribe por ejemplo 22-23, o 0 si ninguna.`);
        return;
      }
      return await showDraft(ctx, data, { ...data.draft, tasks: ids }, tasks);
    }
    case "tareas":
      await ctx.reply("Toca «Sí» o «Cambiar» arriba.");
      return;
    case "photos": {
      if (!data.spec) break;
      if (!images.length) {
        await ctx.reply(`Estoy esperando las fotos de ${data.spec.code}. Mándalas o toca «Listo».`, DONE_KEYBOARD);
        return;
      }
      return await receivePhotos(ctx, data.spec, images);
    }
  }
  await deleteSession(ctx.chatId, ctx.userId);
  await ctx.reply("Perdí el hilo de la foto. Escribe /antes para empezar de nuevo.");
}

async function keepPending(ctx: Context, session: Session<FlowData>, images: ReceivedImage[], ask: string) {
  await save(ctx, session.paso, { ...session.datos, pending: [...(session.datos.pending ?? []), ...images] });
  await ctx.reply(`Guardé las fotos para después. ${ask}`);
}

// --- Tareas de una foto con nombre libre -------------------------------------------

/** Gemini propone las tareas para el nombre (y el motivo) y Carlos confirma. */
async function askTasks(ctx: Context, data: FlowData, draft: Draft): Promise<void> {
  const { Tareas } = await readTabs(["Tareas"]);
  const tasks = readTasks(Tareas);
  await ctx.reply("Buscando las tareas del cronograma para esa foto…");
  const proposed = await proposeTasks(
    draft.name,
    draft.reason || null,
    tasks.map((t) => ({ id: t.id, label: `${t.tarea} (${t.fase})` })),
  );
  await showDraft(ctx, data, { ...draft, tasks: proposed }, tasks);
}

async function showDraft(ctx: Context, data: FlowData, draft: Draft, tasks: Task[]): Promise<void> {
  const label = (id: string) => `• ${id} ${escapeHtml(tasks.find((t) => t.id === id)?.tarea ?? "")}`;
  const text = draft.tasks.length
    ? `Tareas para «${escapeHtml(draft.name)}»:\n${draft.tasks.map(label).join("\n")}\n\n¿Están bien?`
    : `No encontré tareas para «${escapeHtml(draft.name)}». ¿La dejo sin tareas?`;
  await ctx.reply(text, [[button("Sí", "ant:t:ok"), button("Cambiar", "ant:t:otra")]]);
  await save(ctx, "tareas", { ...data, draft });
}

const hitosOf = (ids: string[], tasks: Task[]) => [
  ...new Set(ids.map((id) => tasks.find((t) => t.id === id)?.hito ?? "").filter(Boolean)),
];

async function confirmDraft(ctx: Context, data: FlowData, draft: Draft): Promise<void> {
  const { Tareas } = await readTabs(["Tareas"]);
  const hitos = hitosOf(draft.tasks, readTasks(Tareas));
  if (draft.code) {
    // ANTES del hermano aprobado: se le ponen las tareas y queda esperando su DESPUÉS.
    const pair = (await listPairs()).find((p) => p.code === draft.code && p.state === STATE.pendingApproval);
    await deleteSession(ctx.chatId, ctx.userId);
    if (!pair) {
      await ctx.reply("Ese ANTES ya se resolvió.");
      return;
    }
    await updatePair(pair, { tareas: draft.tasks.join(","), hitos: hitos.join(","), estado: STATE.noAfter });
    await ctx.reply(`Aprobado: ${pair.code} · ${escapeHtml(pair.name)}.`);
    await sendMessage(
      photosTopic(),
      `Carlos aprobó el ANTES ${pair.code} · ${
        escapeHtml(pair.name)
      }. Cuando esté listo, sube su DESPUÉS con /despues.`,
    );
    return;
  }
  const spec: PhotoSpec = {
    code: nextCode(await listPairs()),
    name: draft.name,
    framing: "",
    tasks: draft.tasks,
    hitos,
    state: STATE.noAfter,
    reason: "",
  };
  await ctx.reply(`<b>${spec.code} · ${escapeHtml(spec.name)}</b>`);
  await startPhotos(ctx, spec, data.pending ?? []);
}

// --- Fotos -------------------------------------------------------------------------

async function startPhotos(ctx: Context, spec: PhotoSpec, pending: ReceivedImage[]): Promise<void> {
  await save(ctx, "photos", { spec });
  if (pending.length) return await receivePhotos(ctx, spec, pending);
  await ctx.reply(`Mándame de 1 a ${MAX_PHOTOS} fotos.`);
}

async function pairFolder(spec: PhotoSpec) {
  const root = await topFolder(FOLDERS.beforeAfter);
  return await findOrCreateFolder(
    pairFolderName(spec.code, spec.name),
    root.id,
    appProperties({ codigo: spec.code, nombre: spec.name }),
  );
}

async function receivePhotos(ctx: Context, spec: PhotoSpec, images: ReceivedImage[]): Promise<void> {
  const folder = await pairFolder(spec);
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
        codigo: spec.code,
        nombre: spec.name,
        tipo: "antes",
        tareas: spec.tasks.join(","),
        hitos: spec.hitos.join(","),
        subido_por: ctx.role,
        estado: spec.state,
        motivo: spec.reason,
      }),
    });
  }

  const added = n - existing;
  if (n >= MAX_PHOTOS) {
    if (notes.length) await ctx.reply(notes.join("\n"));
    await finish(ctx, spec);
    return;
  }
  await save(ctx, "photos", { spec });
  const summary = added
    ? `Guardé ${added} foto${
      added > 1 ? "s" : ""
    } de ${spec.code}. Van ${n} de ${MAX_PHOTOS}. Manda otra o toca «Listo».`
    : `No guardé fotos de ${spec.code}. Mándalas de nuevo o toca «Listo».`;
  await ctx.reply([...notes, summary].join("\n"), DONE_KEYBOARD);
}

async function finish(ctx: Context, spec: PhotoSpec): Promise<void> {
  await deleteSession(ctx.chatId, ctx.userId);
  const folder = await pairFolder(spec);
  const files = await listFiles(`${quote(folder.id)} in parents and ${IS_BEFORE}`);
  if (!files.length) {
    await ctx.reply(`${spec.code} quedó sin fotos ANTES. Escribe /antes cuando las tengas.`);
    return;
  }
  const title = `${spec.code} · ${escapeHtml(spec.name)}`;
  if (spec.state === STATE.pendingApproval) {
    await ctx.reply(`Listo: ${title} quedó esperando la aprobación de Carlos.`);
    const carlos = { chatId: envNumber("CARLOS_TG_ID") };
    await sendPhotos(carlos, await photoBytes(files));
    await sendMessage(
      carlos,
      `Tu hermano subió un ANTES por imprevisto:\n<b>${title}</b>\nMotivo: ${escapeHtml(spec.reason)}`,
      [[button("Aprobar", `ant:a:${spec.code}`), button("Rechazar", `ant:r:${spec.code}`)]],
    );
    return;
  }
  const link = folder.webViewLink ? ` <a href="${folder.webViewLink}">Ver en Drive</a>` : "";
  const total = files.length;
  await ctx.reply(
    `Listo: ${title} quedó con ${total} foto${total > 1 ? "s" : ""} ANTES.${link}\nPara la siguiente, escribe /antes.`,
  );
}

// --- Aprobación del ANTES del hermano (Carlos) ---------------------------------------

async function answerApproval(ctx: Context, action: string, code: string): Promise<void> {
  const cb = ctx.callback!;
  if (ctx.role !== "carlos") {
    await answerCallback(cb.id, "Esto lo decide Carlos.");
    return;
  }
  const pair = (await listPairs()).find((p) => p.code === code && p.state === STATE.pendingApproval);
  if (!pair) {
    await answerCallback(cb.id, "Ese ANTES ya se resolvió.");
    return;
  }
  await answerCallback(cb.id);
  const title = `${pair.code} · ${escapeHtml(pair.name)}`;
  if (action === "r") {
    await trashFile(pair.folderId);
    await editMessageText(ctx.chatId, cb.message!.message_id, `Rechazado: ${title}. Quedó en la papelera de Drive.`);
    await sendMessage(photosTopic(), `Carlos no aprobó el ANTES «${escapeHtml(pair.name)}».`);
    return;
  }
  await editMessageText(ctx.chatId, cb.message!.message_id, `Aprobando ${title}…`);
  await askTasks(ctx, {}, { name: pair.name, reason: pair.reason, tasks: [], code: pair.code });
}
