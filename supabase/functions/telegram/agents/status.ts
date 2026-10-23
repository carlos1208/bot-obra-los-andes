// /estado: semana de obra, tareas de hoy y disponible de los 12 M (si se puede ver dinero).
// Lee Config, Tareas, Gastos y Pagos en este momento.

import { bogotaTime, daysBetween, escapeHtml, formatPesos, shortDate, todayISO } from "../../_shared/format.ts";
import { readTabs } from "../../_shared/sheets.ts";
import {
  available12M,
  isHoliday,
  isWorkDay,
  readConfig,
  readTasks,
  tasksForDay,
  weekRange,
  workWeek,
} from "../../_shared/site.ts";
import { canSeeMoney, type Context } from "../context.ts";

export async function status(ctx: Context, today = todayISO()): Promise<void> {
  const sheet = await readTabs(["Config", "Tareas", "Gastos", "Pagos"]);
  const cfg = readConfig(sheet.Config);
  const tasks = readTasks(sheet.Tareas);

  const lines = [`<b>ESTADO – ${shortDate(today)}</b>`];
  const week = workWeek(today, cfg);

  if (week === 0) {
    const left = daysBetween(today, cfg.fecha_inicio);
    const plural = left === 1 ? "" : "s";
    lines.push(
      `La obra empieza el ${shortDate(cfg.fecha_inicio)} (falta${left === 1 ? "" : "n"} ${left} día${plural}).`,
    );
  } else {
    const { monday, saturday } = weekRange(today);
    lines.push(`Semana ${week} de obra (${shortDate(monday)} – ${shortDate(saturday)}).`);
    if (!isWorkDay(today, cfg)) {
      lines.push(isHoliday(today, cfg) ? "Hoy es festivo: no se trabaja." : "Hoy no se trabaja.");
    } else {
      const todays = tasksForDay(tasks, today);
      lines.push("", "<b>Tareas de hoy</b>");
      if (!todays.length) lines.push("No hay tareas programadas.");
      for (const t of todays) {
        const extra = [t.responsable, t.estado === "en curso" ? "en curso" : "", t.tentativo ? "tentativa" : ""]
          .filter(Boolean).join(", ");
        lines.push(`• ${escapeHtml(t.id)} ${escapeHtml(t.tarea)} (${escapeHtml(extra)})`);
      }
    }
  }

  if (canSeeMoney(ctx, cfg)) {
    lines.push("", `Disponible de los 12 M: <b>${formatPesos(available12M(cfg, sheet.Gastos, sheet.Pagos))}</b>`);
  }
  lines.push("", `<i>Dato de la hoja, ${bogotaTime()}</i>`);
  await ctx.reply(lines.join("\n"));
}
