// «Marcar H# cumplido» (solo Carlos, por su privado): muestra el hito y su criterio, y al confirmar pone
// fecha_cumplido en Hitos (hoy, o la fecha que escriba con «Cambiar fecha»).

import { claimStep, deleteSession, readSession, saveSession, type Session } from "../../_shared/db.ts";
import { escapeHtml, parseDateInput, shortDate, todayISO } from "../../_shared/format.ts";
import { readTabs, updateCells } from "../../_shared/sheets.ts";
import { type Milestone, readMilestones } from "../../_shared/site.ts";
import { answerCallback, editKeyboard, editMessageText } from "../../_shared/telegram.ts";
import type { Context } from "../context.ts";
import { button, type FlowBase, isActiveButton } from "../ui.ts";

/** Valor de sesiones.flujo para este flujo. */
export const FLOW = "cumplido";

/** «Marcar H1 cumplido», «marcar h2 como cumplido» → «H1», «H2». */
export function milestoneCommand(text: string | undefined): string | null {
  const m = text?.trim().match(/^marcar\s+(?:el\s+)?h\s*(\d+)\s+(?:como\s+)?cumplido\.?$/i);
  return m ? `H${Number(m[1])}` : null;
}

interface Data extends FlowBase {
  code: string;
  date: string;
}

async function save(ctx: Context, step: string, data: Data): Promise<void> {
  await saveSession(ctx.chatId, ctx.userId, FLOW, step, { ...data, hilo: ctx.threadId ?? null });
}

async function readMilestone(code: string): Promise<Milestone | undefined> {
  return readMilestones((await readTabs(["Hitos"])).Hitos).find((h) => h.hito === code);
}

export async function start(ctx: Context, code: string): Promise<void> {
  if (ctx.role !== "carlos") {
    await ctx.reply("Los hitos los marca Carlos.");
    return;
  }
  if (ctx.place !== "private") {
    await ctx.reply("Los hitos se marcan por tu privado con el bot.");
    return;
  }
  const h = await readMilestone(code);
  if (!h) {
    await ctx.reply(`No encuentro el ${code} en Hitos.`);
    return;
  }
  await showPreview(ctx, h, { code, date: todayISO() });
}

async function showPreview(ctx: Context, h: Milestone, data: Data, editId?: number): Promise<void> {
  const text = [
    `<b>Marcar ${h.hito} cumplido</b>`,
    `${h.hito} ${escapeHtml(h.nombre)}`,
    `Criterio: ${escapeHtml(h.criterio || "—")}`,
    `Fecha de cumplido: ${shortDate(data.date)}`,
    ...(h.fecha_cumplido
      ? ["", `⚠️ Ya figura cumplido el ${shortDate(h.fecha_cumplido)}. Si guardas, cambia la fecha.`]
      : []),
  ].join("\n");
  const keyboard = [
    [button("Sí, guardar", "hit:ok"), button("Cambiar fecha", "hit:f")],
    [button("Cancelar", "hit:x")],
  ];
  let msg = editId;
  if (editId) await editMessageText(ctx.chatId, editId, text, keyboard);
  else msg = (await ctx.reply(text, keyboard)).message_id;
  await save(ctx, "vista", { ...data, msg });
}

export async function onButton(ctx: Context): Promise<void> {
  const cb = ctx.callback!;
  const session = await readSession<Data>(ctx.chatId, ctx.userId);
  if (!session || session.flujo !== FLOW || session.paso !== "vista" || !isActiveButton(session, ctx)) {
    await answerCallback(cb.id, "Ese botón ya no está activo.");
    return;
  }
  await answerCallback(cb.id);
  const action = (cb.data ?? "").split(":")[1];
  const messageId = cb.message!.message_id;
  const data = session.datos;
  if (action === "x") {
    await editMessageText(ctx.chatId, messageId, "Cancelado. No guardé nada.");
    await deleteSession(ctx.chatId, ctx.userId);
    return;
  }
  if (action === "f") {
    await editKeyboard(ctx.chatId, messageId);
    await save(ctx, "fecha", { ...data, msg: undefined });
    await ctx.reply("Escribe la fecha (por ejemplo 24/10 o ayer).");
    return;
  }
  if (action !== "ok" || !(await claimStep(ctx.chatId, ctx.userId, "vista", "guardando"))) return;
  try {
    const h = await readMilestone(data.code);
    if (!h) throw new Error(`Hitos: no está ${data.code}`);
    await updateCells("Hitos", [{ row: h._row, values: { fecha_cumplido: data.date } }]);
  } catch (e) {
    await save(ctx, "vista", data);
    throw e;
  }
  await editMessageText(ctx.chatId, messageId, `✅ ${data.code} cumplido el ${shortDate(data.date)}.`);
  await deleteSession(ctx.chatId, ctx.userId);
}

/** Paso «fecha»: la fecha escrita para el cumplido. */
export async function resume(ctx: Context, session: Session<Data>): Promise<void> {
  const data = session.datos;
  if (session.paso !== "fecha") {
    await ctx.reply("Usa los botones de arriba.");
    return;
  }
  const iso = parseDateInput(ctx.message?.text?.trim() ?? "", todayISO());
  if (!iso) {
    await ctx.reply("No entendí la fecha. Escribe por ejemplo 24/10 o ayer.");
    return;
  }
  const h = await readMilestone(data.code);
  if (!h) {
    await ctx.reply(`No encuentro el ${data.code} en Hitos.`);
    await deleteSession(ctx.chatId, ctx.userId);
    return;
  }
  await showPreview(ctx, h, { ...data, date: iso });
}
