// Avisos programados (sección 6.7 del prompt). Cada uno lee la hoja (y Drive) en ese momento.
// - lunes 07:00: objetivos y lo esperado de la semana, al tema Reportes y al privado de Carlos.
// - lunes a sábado 17:00, sin festivos: los pendientes atrasados (tareas cuyo fin pasó sin terminar y lo esperado
//   hasta hoy que no llegó o nadie confirmó) se recuerdan todos los días hasta que se marquen: al tema Reportes y
//   al privado de Carlos, con un botón por cada uno para marcarlo. Y si no hay reporte del día, el recordatorio
//   para el hermano en el tema Reportes.
// - sábado 17:00, en el mismo aviso diario: el cierre de la semana.

import { envNumber } from "../_shared/env.ts";
import {
  addDays,
  cellDate,
  cellNumber,
  escapeHtml,
  formatPesos,
  isYes,
  normalize,
  shortDate,
  todayISO,
  weekday,
} from "../_shared/format.ts";
import { listPairs, pairLabel, STATE } from "../_shared/pairs.ts";
import { readTabs, updateCells } from "../_shared/sheets.ts";
import {
  type Config,
  isHoliday,
  isWorkDay,
  overdueTasks,
  pettyCashBalance,
  pettyCashToRefill,
  readConfig,
  readTasks,
  type Row,
  weekRange,
  workDaysBetween,
  workWeek,
} from "../_shared/site.ts";
import { type Keyboard, sendMessage, type Target } from "../_shared/telegram.ts";
import { reportError } from "../_shared/errors.ts";
import { button, short } from "../telegram/ui.ts";

export type Job = "lunes" | "diario";

export interface JobResult {
  tarea: Job;
  fecha: string;
  /** Lo que se mandó (o por qué no), para el registro y para la prueba manual. */
  enviado: string[];
}

const reportsTopic = (): Target => ({ chatId: envNumber("GROUP_CHAT_ID"), threadId: envNumber("TOPIC_REPORTES_ID") });
const carlos = (): Target => ({ chatId: envNumber("CARLOS_TG_ID") });

/** Telegram corta en 4096 caracteres: los mensajes largos van en partes, por líneas (los botones, en la última). */
async function send(target: Target, text: string, keyboard?: Keyboard): Promise<void> {
  let part: string[] = [];
  for (const line of text.split("\n")) {
    if (part.length && [...part, line].join("\n").length > 3500) {
      await sendMessage(target, part.join("\n"));
      part = [];
    }
    part.push(line);
  }
  await sendMessage(target, part.join("\n"), keyboard);
}

/** Al tema Reportes (los dos lo ven) y al privado de Carlos. */
async function toBoth(text: string): Promise<void> {
  await send(reportsTopic(), text);
  await send(carlos(), text);
}

const text = (v: unknown) => String(v ?? "").trim();
const inRange = (iso: string | null, from: string, to: string) => iso !== null && from <= iso && iso <= to;
const weekTitle = (cfg: Config, today: string) => {
  const { monday, saturday } = weekRange(today);
  const week = workWeek(today, cfg);
  return `${week ? `SEMANA ${week}` : "SEMANA"} – ${shortDate(monday)} a ${shortDate(saturday)}`;
};

/** Último día de obra (con zócalos, si hay fecha). */
const lastDay = (cfg: Config) =>
  cfg.entrega_con_zocalos && cfg.entrega_con_zocalos > cfg.entrega_sin_zocalos
    ? cfg.entrega_con_zocalos
    : cfg.entrega_sin_zocalos;

function goalsOf(goals: Row[], monday: string): Row[] {
  return goals.filter((r) => cellDate(r.inicio_semana) === monday);
}

function expectedOf(expected: Row[], from: string, to: string): Row[] {
  return expected
    .filter((r) => inRange(cellDate(r.fecha), from, to))
    .sort((a, b) => cellDate(a.fecha)!.localeCompare(cellDate(b.fecha)!));
}

function expectedLine(r: Row, withDate = true): string {
  const task = text(r.tarea_id) ? ` (tarea ${escapeHtml(text(r.tarea_id))})` : "";
  return `• ${withDate ? `${shortDate(cellDate(r.fecha)!)}: ` : ""}${escapeHtml(text(r.quien_o_que))}${task}`;
}

export async function runJob(job: Job): Promise<JobResult> {
  const today = todayISO();
  try {
    return { tarea: job, fecha: today, enviado: job === "lunes" ? await weekStart(today) : await daily(today) };
  } catch (e) {
    await reportError(`aviso programado «${job}» del ${today}`, e);
    throw e;
  }
}

// --- Lunes 07:00 ---------------------------------------------------------------

async function weekStart(today: string): Promise<string[]> {
  const sheet = await readTabs(["Config", "Objetivos", "Esperado"]);
  const cfg = readConfig(sheet.Config);
  const { monday, saturday } = weekRange(today);
  const goals = goalsOf(sheet.Objetivos, monday);
  const expected = expectedOf(sheet.Esperado, monday, saturday);
  if (!goals.length && !expected.length) return ["nada: la semana no tiene objetivos ni nada esperado"];

  const lines = [`<b>${weekTitle(cfg, today)}</b>`];
  if (isHoliday(today, cfg)) lines.push("Hoy es festivo: no se trabaja.");
  lines.push("", "<b>Objetivos de la semana</b>");
  if (!goals.length) lines.push("No hay objetivos para esta semana.");
  for (const r of goals) lines.push(`• <b>${escapeHtml(text(r.persona))}:</b> ${escapeHtml(text(r.objetivo))}`);
  lines.push("", "<b>Lo esperado de la semana</b>");
  if (!expected.length) lines.push("Nada esperado esta semana.");
  lines.push(...expected.map((r) => expectedLine(r)));
  await toBoth(lines.join("\n"));
  return [`objetivos (${goals.length}) y lo esperado (${expected.length}) de la semana`];
}

// --- Lunes a sábado 17:00 ------------------------------------------------------

async function daily(today: string): Promise<string[]> {
  const sheet = await readTabs(["Config", "Esperado", "Reportes", "Objetivos", "Tareas", "Gastos", "Pagos"]);
  const cfg = readConfig(sheet.Config);
  const sent: string[] = [];
  const inWork = cfg.fecha_inicio <= today && today <= lastDay(cfg);

  if (!inWork) sent.push("sin avisos: hoy no hay obra");
  else if (!isWorkDay(today, cfg)) {
    sent.push(`sin avisos: hoy ${isHoliday(today, cfg) ? "es festivo" : "no se trabaja"}`);
  } else {
    const reminded = await overdueReminder(today, cfg, sheet);
    if (reminded) sent.push(`recordatorio de pendientes atrasados (${reminded})`);
    if (!sheet.Reportes.some((r) => cellDate(r.fecha) === today)) {
      await send(
        reportsTopic(),
        "⏰ Todavía no hay reporte de hoy. Manda por aquí las notas del día (voz o texto) y toca «Cerrar el reporte».",
      );
      sent.push("recordatorio del reporte");
    }
  }

  const { monday } = weekRange(today);
  if (weekday(today) === 6 && cfg.fecha_inicio <= today && monday <= lastDay(cfg)) {
    await toBoth(await weeklyClose(today, cfg, sheet));
    sent.push("cierre de la semana");
  }
  if (!sent.length) sent.push("nada: no hay pendientes atrasados y ya hay reporte");
  return sent;
}

/** Cuántos botones lleva el recordatorio (los demás se marcan en el reporte o en la hoja). */
const MAX_BUTTONS = 12;

/**
 * Pendientes atrasados, todos los días hasta que se marquen: lo esperado hasta hoy que no llegó o nadie confirmó
 * (llego distinto de «sí») y las tareas cuyo fin ya pasó sin terminar. Al tema Reportes y, con un botón por cada
 * uno, al privado de Carlos. Marca aviso_enviado en lo esperado la primera vez. Devuelve cuántos son.
 */
async function overdueReminder(today: string, cfg: Config, sheet: Record<string, Row[]>): Promise<number> {
  const expected = expectedOf(sheet.Esperado, "0000-01-01", today).filter((r) => normalize(r.llego) !== "si");
  const tasks = overdueTasks(readTasks(sheet.Tareas), today, cfg);
  if (!expected.length && !tasks.length) return 0;

  const lines = ["⏰ <b>Pendientes atrasados</b> (se recuerdan cada día hasta que se marquen)"];
  if (expected.length) {
    lines.push("", "<b>Lo esperado sin confirmar</b>");
    for (const r of expected) {
      const date = cellDate(r.fecha)!;
      const days = workDaysBetween(addDays(date, 1), today, cfg);
      const when = date === today ? "Hoy" : `${shortDate(date)} (hace ${days} día${days === 1 ? "" : "s"} de obra)`;
      const task = text(r.tarea_id) ? ` (tarea ${escapeHtml(text(r.tarea_id))})` : "";
      const status = normalize(r.llego) === "no" ? " · no llegó" : "";
      lines.push(`• ${when}: ${escapeHtml(text(r.quien_o_que))}${task}${status}`);
    }
  }
  if (tasks.length) {
    lines.push("", "<b>Tareas atrasadas</b>");
    for (const { task: t, days } of tasks) {
      lines.push(
        `• ${escapeHtml(t.id)} ${escapeHtml(short(t.tarea, 60))}: ${days} día${days > 1 ? "s" : ""} de atraso (fin ${
          shortDate(t.fin)
        })`,
      );
    }
  }

  const keyboard: Keyboard = [
    ...expected.map((r) => [button(short(`✅ Llegó: ${text(r.quien_o_que)}`, 40), `atr:e:${r._row}`)]),
    ...tasks.map(({ task: t }) => [button(short(`✅ Terminada: ${t.id} ${t.tarea}`, 40), `atr:t:${t.id}`)]),
  ];
  const extra = keyboard.length - MAX_BUTTONS;
  await send(
    reportsTopic(),
    [...lines, "", "Se marcan en el reporte del día: las tareas por número y lo esperado en «¿Llegó lo esperado hoy?»."]
      .join("\n"),
  );
  await send(
    carlos(),
    [
      ...lines,
      "",
      "Toca lo que ya se hizo para marcarlo.",
      ...(extra > 0 ? [`Hay ${extra} más sin botón: márcalos en el reporte o en la hoja.`] : []),
    ].join("\n"),
    keyboard.slice(0, MAX_BUTTONS),
  );
  const first = expected.filter((r) => !isYes(r.aviso_enviado));
  if (first.length) {
    await updateCells("Esperado", first.map((r) => ({ row: r._row, values: { aviso_enviado: "sí" } })));
  }
  return expected.length + tasks.length;
}

// --- Sábado: cierre de la semana -------------------------------------------------

async function weeklyClose(today: string, cfg: Config, sheet: Record<string, Row[]>): Promise<string> {
  const { monday, saturday } = weekRange(today);
  const lines = [`<b>CIERRE DE LA ${weekTitle(cfg, today)}</b>`];

  // Objetivos: cumplidos (columna cumplido = sí) y pendientes.
  const goals = goalsOf(sheet.Objetivos, monday);
  const goal = (r: Row) =>
    `${escapeHtml(text(r.persona))}: ${escapeHtml(text(r.objetivo))}${
      text(r.comentario) ? ` (${escapeHtml(text(r.comentario))})` : ""
    }`;
  const done = goals.filter((r) => isYes(r.cumplido));
  const open = goals.filter((r) => !isYes(r.cumplido));
  lines.push("", "<b>Objetivos cumplidos</b>", ...(done.length ? done.map((r) => `✅ ${goal(r)}`) : ["Ninguno."]));
  lines.push("", "<b>Objetivos pendientes</b>", ...(open.length ? open.map((r) => `• ${goal(r)}`) : ["Ninguno."]));

  // Lo esperado de la semana (hasta hoy) que no llegó o nadie confirmó.
  const missed = expectedOf(sheet.Esperado, monday, today).filter((r) => normalize(r.llego) !== "si");
  lines.push("", "<b>Lo esperado que no llegó</b>");
  if (!missed.length) lines.push("Todo llegó.");
  for (const r of missed) {
    lines.push(`${expectedLine(r)}: ${normalize(r.llego) === "no" ? "no llegó" : "sin confirmar"}`);
  }

  // Tareas atrasadas: su fin ya pasó y no están terminadas. Atraso en días de obra (lun–sáb sin festivos).
  const late = overdueTasks(readTasks(sheet.Tareas), today, cfg).map(({ task, days }) => ({ t: task, days }));
  lines.push("", "<b>Tareas atrasadas</b>");
  if (!late.length) lines.push("Ninguna.");
  for (const { t, days } of late) {
    lines.push(
      `• ${escapeHtml(t.id)} ${escapeHtml(short(t.tarea, 60))}: ${days} día${days > 1 ? "s" : ""} de atraso (fin ${
        shortDate(t.fin)
      })`,
    );
  }

  // Gastos registrados en la semana y el arqueo de la caja menor.
  const spent = sheet.Gastos
    .map((r) => ({ r, date: cellDate(r.registrado_el) ?? cellDate(r.fecha) }))
    .filter((x) => inRange(x.date, monday, saturday))
    .sort((a, b) => a.date!.localeCompare(b.date!));
  lines.push("", "<b>Gastos de la semana</b>");
  if (!spent.length) lines.push("Ninguno.");
  for (const { r, date } of spent) {
    lines.push(
      `• ${shortDate(date!)}: ${escapeHtml(short(text(r.items), 40))} en ${escapeHtml(text(r.proveedor) || "—")}, ${
        formatPesos(cellNumber(r.valor))
      } (${escapeHtml(text(r.medio_pago))})`,
    );
  }
  if (spent.length) lines.push(`Total: ${formatPesos(spent.reduce((s, x) => s + cellNumber(x.r.valor), 0))}`);
  const cash = pettyCashBalance(cfg, sheet.Gastos, sheet.Pagos);
  const receipts = pettyCashToRefill(cfg, sheet.Gastos, sheet.Pagos);
  lines.push(
    "",
    `🧾 Hoy toca el arqueo de la caja menor: efectivo esperado ${formatPesos(cash)} + facturas sin reponer ${
      formatPesos(receipts)
    } = ${formatPesos(cfg.fondo_caja_menor)}.`,
  );

  // Pares por validar (Drive).
  lines.push("", "<b>Pares por validar</b>");
  try {
    const pairs = (await listPairs()).filter((p) => p.state === STATE.toValidate);
    lines.push(...(pairs.length ? pairs.map((p) => `• ${escapeHtml(pairLabel(p))}`) : ["Ninguno."]));
  } catch (e) {
    await reportError("cierre de la semana: pares de Drive", e);
    lines.push("No pude leer los pares de Drive.");
  }
  return lines.join("\n");
}
