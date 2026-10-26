// Fotos DESPUÉS, validación de cierres y /pendientes. Solo Drive: no escribe en la hoja.
// - DESPUÉS (hermano): elige un ANTES sin DESPUÉS (primero los de tareas de esta semana), el bot le manda el
//   ANTES de referencia y él manda las fotos en el mismo orden. «DESPUÉS AAAA-MM-DD (n)» va con su «ANTES (n)».
//   El par queda «por validar» y Carlos recibe el par por privado.
// - Validación (Carlos): «Cierre validado» · «No cuadra, reviso en sitio» · «Pedir otra foto».

import { catalogPhoto, photoFileName } from "../../_shared/catalog.ts";
import { deleteSession, readSession, saveSession, type Session } from "../../_shared/db.ts";
import { appProperties, updateAppProperties, uploadFile } from "../../_shared/drive.ts";
import { envNumber } from "../../_shared/env.ts";
import { escapeHtml, todayISO } from "../../_shared/format.ts";
import { listPairs, type Pair, pairLabel, photoBytes, STATE, updatePair } from "../../_shared/pairs.ts";
import { readTabs } from "../../_shared/sheets.ts";
import { readTasks, tasksForWeek } from "../../_shared/site.ts";
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
import { button, type FlowBase, short } from "../ui.ts";

/** Valor de sesiones.flujo para este flujo. */
export const FLOW = "despues";
const PAGE_SIZE = 8;

interface FlowData extends FlowBase {
  pending?: ReceivedImage[];
  code?: string;
  /** Códigos ligados a tareas de esta semana (van primero y con 📅). */
  week?: string[];
}

async function save(ctx: Context, step: string, data: FlowData): Promise<void> {
  await saveSession(ctx.chatId, ctx.userId, FLOW, step, { ...data, hilo: ctx.threadId ?? null });
}

const carlos = () => ({ chatId: envNumber("CARLOS_TG_ID") });
const photosTopic = () => ({ chatId: envNumber("GROUP_CHAT_ID"), threadId: envNumber("TOPIC_FOTOS_ID") });
const title = (p: Pair) => `${p.code} · ${escapeHtml(p.name)}`;

async function findPair(code: string, states: string[]): Promise<Pair | undefined> {
  return (await listPairs()).find((p) => p.code === code && states.includes(p.state));
}

/** ANTES sin DESPUÉS: primero los ligados a tareas de esta semana. */
async function waiting(): Promise<{ pairs: Pair[]; week: string[] }> {
  const { Tareas } = await readTabs(["Tareas"]);
  const thisWeek = new Set(tasksForWeek(readTasks(Tareas), todayISO()).map((t) => t.id));
  const pairs = (await listPairs()).filter((p) => p.state === STATE.noAfter);
  const week = pairs.filter((p) => p.tasks.some((id) => thisWeek.has(id))).map((p) => p.code);
  return {
    pairs: [...pairs.filter((p) => week.includes(p.code)), ...pairs.filter((p) => !week.includes(p.code))],
    week,
  };
}

function listKeyboard(pairs: Pair[], week: string[], page: number): Keyboard {
  const from = page * PAGE_SIZE;
  const rows: Keyboard = pairs
    .slice(from, from + PAGE_SIZE)
    .map((p) => [button(`${week.includes(p.code) ? "📅 " : ""}${p.code} · ${short(p.name, 32)}`, `dsp:c:${p.code}`)]);
  const nav = [];
  if (page > 0) nav.push(button("◀ Anteriores", `dsp:p:${page - 1}`));
  if (from + PAGE_SIZE < pairs.length) nav.push(button("Siguientes ▶", `dsp:p:${page + 1}`));
  if (nav.length) rows.push(nav);
  rows.push([button("Cancelar", "dsp:x")]);
  return rows;
}

/** /despues, o fotos del hermano en el tema «Antes y después». */
export async function start(ctx: Context, pending: ReceivedImage[] = []): Promise<void> {
  const { pairs, week } = await waiting();
  if (!pairs.length) {
    await deleteSession(ctx.chatId, ctx.userId);
    await ctx.reply("No hay fotos ANTES esperando su DESPUÉS.");
    return;
  }
  await save(ctx, "elegir", { pending, week });
  const n = pending.length;
  const question = n
    ? `Recibí ${n} foto${n > 1 ? "s" : ""}. ¿De cuál ANTES es el DESPUÉS?`
    : "¿De cuál ANTES es el DESPUÉS?";
  const hint = week.length ? "\n📅 = de tareas de esta semana." : "";
  await ctx.reply(`${question}${hint}`, listKeyboard(pairs, week, 0));
}

// --- Botones «dsp:…» --------------------------------------------------------------

export async function onButton(ctx: Context): Promise<void> {
  const cb = ctx.callback!;
  const messageId = cb.message!.message_id;
  const [, action, value] = (cb.data ?? "").split(":");
  const session = await readSession<FlowData>(ctx.chatId, ctx.userId);
  const data = session?.flujo === FLOW ? session.datos : null;

  if (action === "c") {
    // También llega desde «Pedir otra foto», sin una sesión abierta.
    const pair = await findPair(value, [STATE.noAfter]);
    if (!pair) {
      await answerCallback(cb.id, "Esa foto ya tiene DESPUÉS.");
      return;
    }
    await answerCallback(cb.id);
    await editKeyboard(ctx.chatId, messageId);
    return await choose(ctx, pair, data?.pending ?? []);
  }
  if (!data) {
    await answerCallback(cb.id, "Esto ya venció. Escribe /despues.");
    return;
  }
  await answerCallback(cb.id);
  if (action === "p") {
    const { pairs, week } = await waiting();
    await editKeyboard(ctx.chatId, messageId, listKeyboard(pairs, week, Number(value) || 0));
    return;
  }
  if (action === "x") {
    await deleteSession(ctx.chatId, ctx.userId);
    await editMessageText(ctx.chatId, messageId, "Cancelado. No guardé nada nuevo.");
    return;
  }
  if (action === "fin" && data.code) {
    await editKeyboard(ctx.chatId, messageId);
    return await finish(ctx, data.code);
  }
}

/** Manda el ANTES de referencia y pide los DESPUÉS en el mismo orden. */
async function choose(ctx: Context, pair: Pair, pending: ReceivedImage[]): Promise<void> {
  const target = { chatId: ctx.chatId, threadId: ctx.threadId };
  await sendPhotos(target, await photoBytes(pair.before));
  const framing = catalogPhoto(pair.code)?.encuadre;
  const n = pair.before.length;
  await ctx.reply(
    [
      `<b>${title(pair)}</b>`,
      ...(framing ? [`Encuadre: ${escapeHtml(framing)}`] : []),
      n > 1
        ? `Manda ${n} fotos DESPUÉS, en el mismo orden y desde el mismo ángulo que estas.`
        : "Manda la foto DESPUÉS desde el mismo ángulo que esta.",
    ].join("\n"),
  );
  await save(ctx, "fotos", { code: pair.code });
  if (pending.length) await receiveAfter(ctx, pair, pending);
}

export async function resume(ctx: Context, session: Session<FlowData>): Promise<void> {
  const images = ctx.messages.map(imageOf).filter((i): i is ReceivedImage => i !== null);
  if (session.paso === "elegir") {
    if (images.length) {
      await save(ctx, "elegir", { ...session.datos, pending: [...(session.datos.pending ?? []), ...images] });
      await ctx.reply("Guardé las fotos. Elige arriba de cuál ANTES son.");
    } else {
      await ctx.reply("Elige arriba de cuál ANTES es el DESPUÉS, o toca «Cancelar».");
    }
    return;
  }
  const pair = await findPair(session.datos.code ?? "", [STATE.noAfter]);
  if (!pair) {
    await deleteSession(ctx.chatId, ctx.userId);
    await ctx.reply("Esa foto ya no espera su DESPUÉS. Escribe /despues para ver las que faltan.");
    return;
  }
  if (!images.length) {
    await ctx.reply(`Estoy esperando las fotos DESPUÉS de ${pair.code}. Mándalas o toca «Listo».`, [[
      button("Listo", "dsp:fin"),
    ]]);
    return;
  }
  await receiveAfter(ctx, pair, images);
}

async function receiveAfter(ctx: Context, pair: Pair, images: ReceivedImage[]): Promise<void> {
  const total = pair.before.length;
  const existing = pair.after.length;
  const room = Math.max(0, total - existing);
  const notes: string[] = [];
  if (images.length > room) {
    notes.push(`Solo van ${total} DESPUÉS, una por cada ANTES. No guardé ${images.length - room}.`);
  }
  const date = todayISO();
  let n = existing;
  for (const img of images.slice(0, room)) {
    if (img.size && img.size > MAX_FILE_BYTES) {
      notes.push("Una foto pesa más de 20 MB. Mándala como foto, no como archivo.");
      continue;
    }
    const { bytes } = await downloadFile(img.fileId);
    n++;
    await uploadFile({
      name: photoFileName("DESPUÉS", date, n, img.extension),
      parent: pair.folderId,
      mimeType: img.mime,
      bytes,
      appProperties: appProperties({
        codigo: pair.code,
        nombre: pair.name,
        tipo: "después",
        tareas: pair.tasks.join(","),
        hitos: pair.hitos.join(","),
        subido_por: ctx.role,
        estado: STATE.noAfter,
      }),
    });
  }
  if (n >= total) {
    if (notes.length) await ctx.reply(notes.join("\n"));
    return await finish(ctx, pair.code);
  }
  await save(ctx, "fotos", { code: pair.code });
  await ctx.reply(
    [...notes, `Guardé ${n} de ${total}. Manda la siguiente (${n + 1}) o toca «Listo».`].join("\n"),
    [[button("Listo", "dsp:fin")]],
  );
}

async function finish(ctx: Context, code: string): Promise<void> {
  await deleteSession(ctx.chatId, ctx.userId);
  const pair = await findPair(code, [STATE.noAfter]);
  if (!pair?.after.length) {
    await ctx.reply("No guardé fotos DESPUÉS. Escribe /despues cuando las tengas.");
    return;
  }
  await updatePair(pair, { estado: STATE.toValidate });
  const told = ctx.role === "hermano" ? " Le avisé a Carlos." : "";
  await ctx.reply(`Listo: ${title(pair)} quedó por validar.${told}`);
  await sendValidation({ ...pair, state: STATE.toValidate });
}

// --- Validación (Carlos) ------------------------------------------------------------

const VALIDATION_KEYBOARD = (code: string): Keyboard => [
  [button("Cierre validado", `val:ok:${code}`)],
  [button("No cuadra, reviso en sitio", `val:sitio:${code}`)],
  [button("Pedir otra foto", `val:otra:${code}`)],
];

/** El par como álbum (ANTES y luego DESPUÉS) y los datos para validar, por privado a Carlos. */
async function sendValidation(pair: Pair): Promise<void> {
  await sendPhotos(carlos(), await photoBytes([...pair.before, ...pair.after]));
  const { Tareas, Hitos } = await readTabs(["Tareas", "Hitos"]);
  const tasks = readTasks(Tareas);
  const lines = [
    `<b>Validar cierre: ${title(pair)}</b>`,
    `Arriba: ${pair.before.length} ANTES y luego ${pair.after.length} DESPUÉS.`,
    ...pair.tasks.map((id) => `Tarea ${id}: ${escapeHtml(tasks.find((t) => t.id === id)?.tarea ?? "")}`),
    ...pair.hitos.map((h) => {
      const hito = Hitos.find((r) => String(r.hito) === h);
      return `Hito ${h}${hito ? ` – ${escapeHtml(String(hito.nombre))}: ${escapeHtml(String(hito.criterio))}` : ""}`;
    }),
    `Estado: ${pair.state}`,
  ];
  await sendMessage(carlos(), lines.join("\n"), VALIDATION_KEYBOARD(pair.code));
}

/** Botones «val:…»: validar, revisar en sitio, pedir otra foto o ver un par desde /pendientes. */
export async function onValidation(ctx: Context): Promise<void> {
  const cb = ctx.callback!;
  if (ctx.role !== "carlos") {
    await answerCallback(cb.id, "Esto lo valida Carlos.");
    return;
  }
  const [, action, code] = (cb.data ?? "").split(":");
  const pair = await findPair(code, [STATE.toValidate, STATE.checkOnSite]);
  if (!pair) {
    await answerCallback(cb.id, "Ese par ya no está por validar.");
    return;
  }
  await answerCallback(cb.id);
  const messageId = cb.message!.message_id;
  if (action === "ver") return await sendValidation(pair);
  if (action === "ok") {
    await updatePair(pair, { estado: STATE.validated });
    await editMessageText(ctx.chatId, messageId, `✅ Cierre validado: ${title(pair)}.`);
    return;
  }
  if (action === "sitio") {
    await updatePair(pair, { estado: STATE.checkOnSite });
    await editMessageText(ctx.chatId, messageId, `🔎 Revisar en sitio: ${title(pair)}. Sale en /pendientes.`);
    return;
  }
  if (action === "otra") {
    // Los DESPUÉS quedan descartados (no se borran) y el ANTES vuelve a esperar su DESPUÉS.
    await Promise.all(pair.after.map((f) => updateAppProperties(f.id, { estado: STATE.discarded })));
    await updatePair({ ...pair, after: [] }, { estado: STATE.noAfter });
    await editMessageText(ctx.chatId, messageId, `📷 Pediste otra foto DESPUÉS de ${title(pair)}.`);
    await sendMessage(photosTopic(), `Carlos pide otra foto DESPUÉS de ${title(pair)}.`, [[
      button("Subir DESPUÉS", `dsp:c:${pair.code}`),
    ]]);
  }
}

/** /pendientes (Carlos): pares por validar y los que quedaron para revisar en sitio. */
export async function pending(ctx: Context): Promise<void> {
  if (ctx.role !== "carlos") {
    await ctx.reply("/pendientes es para Carlos.");
    return;
  }
  const pairs = await listPairs();
  const toValidate = pairs.filter((p) => p.state === STATE.toValidate);
  const onSite = pairs.filter((p) => p.state === STATE.checkOnSite);
  if (!toValidate.length && !onSite.length) {
    await ctx.reply("No hay pares por validar ni por revisar en sitio.");
    return;
  }
  const section = (name: string, list: Pair[]) =>
    list.length ? [`<b>${name}</b>`, ...list.map((p) => `• ${escapeHtml(pairLabel(p))}`), ""] : [];
  const text = [...section("Por validar", toValidate), ...section("Revisar en sitio", onSite)].join("\n").trim();
  const keyboard = [...toValidate, ...onSite].map((
    p,
  ) => [button(`Ver ${p.code} · ${short(p.name, 30)}`, `val:ver:${p.code}`)]);
  await ctx.reply(text, keyboard);
}
