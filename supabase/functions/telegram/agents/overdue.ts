// Botones del recordatorio diario de pendientes atrasados (solo en el privado de Carlos):
// «atr:t:<id>» y «atr:e:<fila>» preguntan «¿Lo marco hecho?»; con «Sí» se escribe estado = terminada en Tareas
// o llego = sí (y confirmado_por) en Esperado. Se lee la hoja en el momento: si ya estaba hecho, lo dice.

import { cellDate, escapeHtml, normalize, shortDate } from "../../_shared/format.ts";
import { readTabs, updateCells } from "../../_shared/sheets.ts";
import { readTasks, type Row } from "../../_shared/site.ts";
import { answerCallback, editMessageText } from "../../_shared/telegram.ts";
import type { Context } from "../context.ts";
import { button } from "../ui.ts";

const text = (v: unknown) => String(v ?? "").trim();

async function expectedRow(row: number): Promise<Row | undefined> {
  return (await readTabs(["Esperado"])).Esperado.find((r) => r._row === row);
}

const expectedLabel = (r: Row) => {
  const date = cellDate(r.fecha);
  return `«${escapeHtml(text(r.quien_o_que))}»${date ? ` (${shortDate(date)})` : ""}`;
};

export async function onButton(ctx: Context): Promise<void> {
  const cb = ctx.callback!;
  const [, action, key] = (cb.data ?? "").split(":");
  if (ctx.role !== "carlos") {
    await answerCallback(cb.id, "Esto lo marca Carlos.");
    return;
  }
  const messageId = cb.message!.message_id;

  if (action === "x") {
    await answerCallback(cb.id);
    await editMessageText(ctx.chatId, messageId, "Listo, no cambié nada.");
    return;
  }

  if (action === "t" || action === "T") {
    const task = readTasks((await readTabs(["Tareas"])).Tareas).find((t) => t.id === key);
    if (!task) {
      await answerCallback(cb.id, `No encuentro la tarea ${key} en Tareas.`);
      return;
    }
    const label = `${escapeHtml(task.id)} «${escapeHtml(task.tarea)}»`;
    if (task.estado === "terminada") {
      await answerCallback(cb.id, `La tarea ${task.id} ya está terminada.`);
      if (action === "T") await editMessageText(ctx.chatId, messageId, `✅ La tarea ${label} ya estaba terminada.`);
      return;
    }
    await answerCallback(cb.id);
    if (action === "t") {
      await ctx.reply(`¿Marco la tarea ${label} como terminada?`, [[
        button("Sí, terminada", `atr:T:${task.id}`),
        button("No", "atr:x"),
      ]]);
      return;
    }
    await updateCells("Tareas", [{ row: task._row, values: { estado: "terminada" } }]);
    await editMessageText(ctx.chatId, messageId, `✅ Tarea ${label} terminada.`);
    return;
  }

  if (action === "e" || action === "E") {
    const r = await expectedRow(Number(key));
    if (!r || !text(r.quien_o_que)) {
      await answerCallback(cb.id, "Esa fila de Esperado ya no está. Míralo en la hoja.");
      return;
    }
    if (normalize(r.llego) === "si") {
      await answerCallback(cb.id, "Ya estaba confirmado.");
      if (action === "E") await editMessageText(ctx.chatId, messageId, `✅ Ya estaba confirmado: ${expectedLabel(r)}.`);
      return;
    }
    await answerCallback(cb.id);
    if (action === "e") {
      await ctx.reply(`¿Marco que llegó ${expectedLabel(r)}?`, [[
        button("Sí, llegó", `atr:E:${r._row}`),
        button("No", "atr:x"),
      ]]);
      return;
    }
    await updateCells("Esperado", [{ row: r._row, values: { llego: "sí", confirmado_por: "Carlos" } }]);
    await editMessageText(ctx.chatId, messageId, `✅ Llegó: ${expectedLabel(r)}.`);
    return;
  }
  await answerCallback(cb.id, "Ese botón ya no está activo.");
}
