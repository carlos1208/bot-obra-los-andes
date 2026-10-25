// Reporte diario (sección 6.2 del prompt), de dos formas:
// - Con botones (/reporte): por secciones, con selección múltiple.
// - Con notas: cada texto o nota de voz del tema Reportes se guarda en la pestaña Notas (transcripción y
//   resumen) y el bot rearma un solo reporte con todas las notas del día. Si se contradicen, pregunta.
// El reporte se escribe solo con «Sí, guardar» y hay uno por día: guardarlo otra vez actualiza su fila.
// Las notas se guardan sin confirmar (lo pidió Carlos): son la entrada del reporte, no el reporte.
// Al guardar: fila en Reportes, estado en Tareas, llegó en Esperado y el resumen a Carlos por privado.

import { claimStep, deleteSession, readSession, saveSession, type Session } from "../../_shared/db.ts";
import { envNumber } from "../../_shared/env.ts";
import {
  type Conflict,
  type DayNote,
  extractDayReport,
  type FreeReport,
  type ReportOptions,
  summarizeNote,
} from "../../_shared/extractors.ts";
import {
  bogotaTime,
  cellDate,
  cellNumber,
  escapeHtml,
  formatPesos,
  normalize,
  shortDate,
  todayISO,
} from "../../_shared/format.ts";
import { appendRow, readTabs, updateCells } from "../../_shared/sheets.ts";
import {
  mondayOf,
  nextWorkDay,
  pettyCashBalance,
  readConfig,
  readTasks,
  type Row,
  tasksForDay,
  tasksForWeek,
  weeklyObjective,
} from "../../_shared/site.ts";
import {
  answerCallback,
  downloadFile,
  editKeyboard,
  editMessageText,
  type Keyboard,
  sendMessage,
} from "../../_shared/telegram.ts";
import type { Context } from "../context.ts";
import { button, check, type FlowBase, isActiveButton, roleLabel, short } from "../ui.ts";
import * as expenses from "./expenses.ts";

/** Valor de sesiones.flujo para este flujo. */
export const FLOW = "reporte";

const WATER = ["Sin novedad", "Llamé, sin fecha", "Tienen fecha", "Instalado", "Otro"];
const NEWS = [
  "Sin novedad",
  "Faltó material",
  "El albañil no vino",
  "Daño o imprevisto",
  "Visita de otro oficio",
  "Sin luz",
  "Otro",
];
const OTHER = "Otro";
const NO_NEWS = "Sin novedad";
const DECISION = { id: "d", label: "Decisión de Carlos" };
const OTHER_OPTION = { id: "o", label: "Otro" };
/** Texto o nota de voz más corto que esto se guarda tal cual; si es más largo, Gemini lo resume. */
const SHORT_NOTE = 150;
/** Pestaña de las notas del día. */
const NOTES = "Notas";
/** Rondas de aclaraciones antes de dejar las incongruencias como aviso en la vista previa. */
const MAX_ROUNDS = 2;

type Status = "terminada" | "avanzó";

interface Option {
  id: string;
  label: string;
}

interface Expected {
  label: string;
  arrived?: boolean;
}

interface Data extends FlowBase {
  date: string;
  tasks: Option[];
  done: string[];
  status: Record<string, Status>;
  expected: Expected[];
  /** «No llegó» que ya se avisaron a Carlos. */
  notified: string[];
  water: string;
  waterDetail: string;
  news: string[];
  newsDetail: string;
  tomorrowOptions: Option[];
  tomorrow: string[];
  tomorrowDetail: string;
  /** Corrigiendo una sección: al terminarla vuelve a la vista previa. */
  fixing?: boolean;
  /** Armado con las notas del día: cuántas (sin contar las aclaraciones). */
  notes?: number;
  /** Incongruencias por resolver y las respuestas dadas. */
  conflicts?: Conflict[];
  answers?: string[];
  /** Preguntas ya respondidas: no se vuelven a hacer. */
  answered?: string[];
  /** Veces que se rearmó por aclaraciones. */
  rounds?: number;
  /** Incongruencias que quedaron sin resolver: se muestran en la vista previa. */
  warnings?: string[];
  /** Lo que encontró Gemini en la última armada (de paso, no se guarda). */
  conflictsFound?: Conflict[];
}

// --- Sesión y mensajes ---------------------------------------------------------

async function save(ctx: Context, step: string, data: Data): Promise<void> {
  await saveSession(ctx.chatId, ctx.userId, FLOW, step, data as unknown as Record<string, unknown>);
}

/** Manda al tema del reporte (que puede no ser el del mensaje, si el gasto se hizo en «Gastos»). */
async function say(ctx: Context, data: Data, text: string, keyboard?: Keyboard): Promise<number> {
  const m = await sendMessage({ chatId: ctx.chatId, threadId: data.hilo ?? undefined }, text, keyboard);
  return m.message_id;
}

/** Cierra el mensaje de una sección con su resumen y sin botones. */
async function closeSection(ctx: Context, messageId: number, summary: string): Promise<void> {
  await editMessageText(ctx.chatId, messageId, summary);
}

/** Fila de hoy en Reportes (hay una por día). */
function todayReport(rows: Row[], date: string): Row | undefined {
  return rows.filter((r) => cellDate(r.fecha) === date).at(-1);
}

const idList = (v: unknown) => String(v ?? "").split(/[,;\s]+/).filter(Boolean);

async function baseData(ctx: Context): Promise<Data> {
  const date = todayISO();
  const { Config, Tareas, Esperado, Reportes } = await readTabs(["Config", "Tareas", "Esperado", "Reportes"]);
  const cfg = readConfig(Config);
  const tasks = readTasks(Tareas);
  const option = (t: { id: string; tarea: string }) => ({ id: t.id, label: t.tarea });
  // Las tareas abiertas de la semana, más las del reporte ya guardado hoy (pueden estar terminadas).
  const saved = todayReport(Reportes, date);
  const listed = new Set([
    ...tasksForWeek(tasks, date).map((t) => t.id),
    ...idList(saved?.tareas_terminadas),
    ...idList(saved?.tareas_avanzadas),
  ]);
  return {
    hilo: ctx.threadId ?? null,
    date,
    tasks: tasks.filter((t) => listed.has(t.id)).map(option),
    done: [],
    status: {},
    expected: Esperado.filter((r) => cellDate(r.fecha) === date).map((r) => ({ label: String(r.quien_o_que) })),
    notified: [],
    water: "",
    waterDetail: "",
    news: [],
    newsDetail: "",
    tomorrowOptions: [...tasksForDay(tasks, nextWorkDay(date, cfg)).map(option), DECISION, OTHER_OPTION],
    tomorrow: [],
    tomorrowDetail: "",
  };
}

/** /reporte: empieza el reporte con botones. */
export async function start(ctx: Context): Promise<void> {
  const data = await baseData(ctx);
  await showStep(ctx, data, data.tasks.length ? "hecho" : "compras");
}

// --- Secciones -----------------------------------------------------------------

/** Botón de «Para mañana»: las tareas llevan su número; «Decisión de Carlos» y «Otro», no. */
const optionLabel = (o: Option) => o.id === DECISION.id || o.id === OTHER_OPTION.id ? o.label : `${o.id} ${o.label}`;

const title = (data: Data) => `<b>REPORTE – ${shortDate(data.date)}</b>`;
const taskLabel = (data: Data, id: string) => data.tasks.find((t) => t.id === id)?.label ?? id;

/** Lo que se lee de la hoja en este momento para las secciones automáticas y la vista previa. */
async function sheetFacts(data: Data) {
  const { Config, Tareas, Gastos, Pagos, Objetivos, Reportes } = await readTabs([
    "Config",
    "Tareas",
    "Gastos",
    "Pagos",
    "Objetivos",
    "Reportes",
  ]);
  const cfg = readConfig(Config);
  const finishedNow = data.done.filter((id) => data.status[id] === "terminada");
  return {
    objective: weeklyObjective(readTasks(Tareas), data.date, finishedNow),
    objectives: Objetivos
      .filter((r) => cellDate(r.inicio_semana) === mondayOf(data.date))
      .map((r) => `${r.persona}: ${r.objetivo}`),
    purchases: Gastos
      .filter((r: Row) => cellDate(r.fecha) === data.date)
      .map((r) => `${short(String(r.items ?? ""), 40)} en ${r.proveedor || "—"}, ${formatPesos(cellNumber(r.valor))}`),
    balance: pettyCashBalance(cfg, Gastos, Pagos),
    savedToday: Boolean(todayReport(Reportes, data.date)),
  };
}

type Facts = Awaited<ReturnType<typeof sheetFacts>>;

/** Muestra el paso en un mensaje nuevo (o editando `editId`) y guarda la sesión. */
async function showStep(ctx: Context, data: Data, step: string, editId?: number): Promise<void> {
  let text: string;
  let keyboard: Keyboard | undefined;
  switch (step) {
    case "hecho":
      text = `${title(data)}\n<b>Se hizo hoy:</b> marca las tareas que se trabajaron.`;
      keyboard = [
        ...data.tasks.map((
          t,
        ) => [button(check(short(`${t.id} ${t.label}`), data.done.includes(t.id)), `rep:t:${t.id}`)]),
        [button("Listo", "rep:t1"), button("Cancelar", "rep:x")],
      ];
      break;
    case "estado":
      text = [
        "<b>Para cada tarea, ¿terminada o avanzó?</b>",
        ...data.done.map((id) => `${id} – ${escapeHtml(short(taskLabel(data, id), 60))}`),
      ].join("\n");
      keyboard = [
        ...data.done.map((id) => [
          button(`${data.status[id] === "terminada" ? "✅ " : ""}${id} Terminada`, `rep:s:${id}:t`),
          button(`${data.status[id] === "avanzó" ? "✅ " : ""}${id} Avanzó`, `rep:s:${id}:a`),
        ]),
        [button("Listo", "rep:s1")],
      ];
      break;
    case "compras": {
      const f = await sheetFacts(data);
      text = [
        title(data),
        `<b>Avance del objetivo semanal:</b> ${objectiveText(f)}`,
        ...f.objectives.map((o) => `• ${escapeHtml(o)}`),
        "<b>Fotos:</b> —",
        `<b>Compras de hoy:</b> ${escapeHtml(f.purchases.join("; ") || "ninguna")}`,
        `<b>Caja menor:</b> ${formatPesos(f.balance)}`,
      ].join("\n");
      keyboard = [[button("Agregar compra", "rep:c"), button("Seguir", "rep:c1")]];
      break;
    }
    case "esperado":
      text = [
        "<b>¿Llegó lo esperado hoy?</b>",
        ...data.expected.map((e, i) => `${i + 1}. ${escapeHtml(e.label)}`),
      ].join("\n");
      keyboard = [
        ...data.expected.map((e, i) => [
          button(`${e.arrived === true ? "✅ " : ""}${i + 1} Llegó`, `rep:e:${i}:1`),
          button(`${e.arrived === false ? "❌ " : ""}${i + 1} No llegó`, `rep:e:${i}:0`),
        ]),
        [button("Listo", "rep:e1")],
      ];
      break;
    case "agua":
      text = "<b>Agua (Triple A):</b> ¿qué novedad hay?";
      keyboard = pairs(WATER.map((w, i) => button(w, `rep:w:${i}`)));
      break;
    case "novedades":
      text = "<b>Novedades:</b> marca las que apliquen.";
      keyboard = [
        ...pairs(NEWS.map((n, i) => button(check(n, data.news.includes(n)), `rep:n:${i}`))),
        [button("Listo", "rep:n1")],
      ];
      break;
    case "manana":
      text = "<b>Para mañana se necesita:</b> marca lo que aplique.";
      keyboard = [
        ...data.tomorrowOptions.map((o) => [
          button(check(short(optionLabel(o)), data.tomorrow.includes(o.id)), `rep:m:${o.id}`),
        ]),
        [button("Listo", "rep:m1")],
      ];
      break;
    case "agua_otro":
      text = "Agua: escribe o manda una nota de voz con la novedad.";
      break;
    case "novedades_otro":
      text = "Novedades: escribe o manda una nota de voz con lo que pasó.";
      break;
    case "manana_otro":
      text = "Para mañana: escribe o manda una nota de voz con lo que se necesita.";
      break;
    case "incongruencia": {
      const i = data.answers?.length ?? 0;
      const c = data.conflicts![i];
      text = `<b>Las notas no coinciden (${i + 1} de ${data.conflicts!.length})</b>\n${escapeHtml(c.question)}`;
      keyboard = [
        ...c.options.map((o, j) => [button(short(o), `rep:k:${i}:${j}`)]),
        [button("Mando otra nota", `rep:k:${i}:n`)],
      ];
      break;
    }
    default:
      return await showPreview(ctx, data, editId);
  }
  let msg = editId;
  if (editId) await editMessageText(ctx.chatId, editId, text, keyboard);
  else msg = await say(ctx, data, text, keyboard);
  await save(ctx, step, { ...data, msg: keyboard ? msg : undefined });
}

function pairs(buttons: ReturnType<typeof button>[]): Keyboard {
  const rows: Keyboard = [];
  for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
  return rows;
}

const objectiveText = (f: Facts) =>
  f.objective.total ? `${f.objective.done} de ${f.objective.total} tareas` : "no hay tareas que terminen esta semana";

/** Paso siguiente según el orden del reporte. Si se está corrigiendo, vuelve a la vista previa. */
function nextStep(data: Data, from: string): string {
  if (from === "hecho" && data.done.length) return "estado";
  if (data.fixing) return "vista";
  const order = ["hecho", "estado", "compras", "esperado", "agua", "novedades", "manana", "vista"];
  let i = order.indexOf(from) + 1;
  if (from.endsWith("_otro")) i = order.indexOf(from.replace("_otro", "")) + 1;
  if (order[i] === "estado") i++;
  if (order[i] === "esperado" && !data.expected.length) i++;
  return order[i];
}

// --- Texto del reporte ---------------------------------------------------------

function doneText(data: Data): string {
  return data.done.map((id) => `${id} ${data.status[id] ?? "avanzó"}`).join(", ") || "nada de la lista";
}

function expectedText(data: Data): string {
  if (!data.expected.length) return "nada esperado hoy";
  const missing = data.expected.filter((e) => e.arrived === false).map((e) => e.label);
  const unknown = data.expected.filter((e) => e.arrived === undefined).map((e) => e.label);
  const parts = [missing.length ? `no: ${missing.join("; ")}` : unknown.length ? "" : "sí"];
  if (unknown.length) parts.push(`sin dato: ${unknown.join("; ")}`);
  return parts.filter(Boolean).join(" · ");
}

function waterText(data: Data): string {
  if (!data.water) return "sin dato";
  if (data.water === OTHER) return data.waterDetail || OTHER;
  return data.waterDetail ? `${data.water}: ${data.waterDetail}` : data.water;
}

function newsText(data: Data): string {
  const chosen = data.news.filter((n) => n !== OTHER);
  const detail = data.newsDetail ? [data.newsDetail] : data.news.includes(OTHER) ? [OTHER] : [];
  return [...chosen, ...detail].join(", ") || "sin dato";
}

function tomorrowText(data: Data): string {
  const labels = data.tomorrow
    .filter((id) => id !== OTHER_OPTION.id)
    .map((id) => {
      const o = data.tomorrowOptions.find((x) => x.id === id);
      return o ? optionLabel(o) : id;
    });
  if (data.tomorrowDetail) labels.push(data.tomorrowDetail);
  return labels.join(", ") || "nada";
}

/** Texto plano del reporte con el formato del prompt. */
function reportText(data: Data, f: Facts): string {
  return [
    `REPORTE – ${shortDate(data.date)}`,
    `Se hizo hoy: ${doneText(data)}`,
    `Avance del objetivo semanal: ${objectiveText(f)}`,
    "Fotos: —",
    `Compras: ${f.purchases.join("; ") || "ninguna"} · Caja menor: ${formatPesos(f.balance)}`,
    `¿Llegó lo esperado hoy?: ${expectedText(data)}`,
    `Agua (Triple A): ${waterText(data)}`,
    `Novedades: ${newsText(data)}`,
    `Para mañana se necesita: ${tomorrowText(data)}`,
  ].join("\n");
}

const PREVIEW_KEYBOARD: Keyboard = [
  [button("Sí, guardar", "rep:ok"), button("Corregir sección", "rep:fix")],
  [button("Cancelar", "rep:x")],
];

function fixKeyboard(data: Data): Keyboard {
  return pairs([
    button("Se hizo hoy", "rep:fx:hecho"),
    button("Compras", "rep:fx:compras"),
    ...(data.expected.length ? [button("Lo esperado", "rep:fx:esperado")] : []),
    button("Agua", "rep:fx:agua"),
    button("Novedades", "rep:fx:novedades"),
    button("Para mañana", "rep:fx:manana"),
    button("Volver", "rep:v"),
  ]);
}

async function showPreview(ctx: Context, data: Data, editId?: number): Promise<void> {
  const f = await sheetFacts(data);
  const header = data.notes ? `Armado con ${data.notes} nota${data.notes > 1 ? "s" : ""} de hoy.\n\n` : "";
  const warnings = (data.warnings ?? []).map((w) => `\n⚠️ Revisa: ${escapeHtml(w)}`).join("");
  const question = f.savedToday ? "Ya hay un reporte de hoy. ¿Lo actualizo con este?" : "¿Lo guardo?";
  const text = `${header}${escapeHtml(reportText(data, f))}${warnings ? `\n${warnings}` : ""}\n\n${question}`;
  let msg = editId;
  if (editId) await editMessageText(ctx.chatId, editId, text, PREVIEW_KEYBOARD);
  else msg = await say(ctx, data, text, PREVIEW_KEYBOARD);
  await save(ctx, "vista", { ...data, fixing: false, msg });
}

// --- Botones «rep:…» -----------------------------------------------------------

export async function onButton(ctx: Context): Promise<void> {
  const cb = ctx.callback!;
  const session = await readSession<Data>(ctx.chatId, ctx.userId);
  if (!session || session.flujo !== FLOW || !isActiveButton(session, ctx)) {
    await answerCallback(cb.id, "Ese botón ya no está activo.");
    return;
  }
  const data = session.datos;
  const step = session.paso;
  const messageId = cb.message!.message_id;
  const [, action, value, extra] = (cb.data ?? "").split(":");
  const toggle = (list: string[], item: string) =>
    list.includes(item) ? list.filter((x) => x !== item) : [...list, item];

  if (action === "x") {
    await answerCallback(cb.id);
    await deleteSession(ctx.chatId, ctx.userId);
    await editMessageText(ctx.chatId, messageId, "Reporte cancelado. No guardé nada.");
    return;
  }

  switch (`${step}/${action}`) {
    case "hecho/t":
      data.done = toggle(data.done, value);
      await answerCallback(cb.id);
      return await showStep(ctx, data, step, messageId);
    case "hecho/t1": {
      await answerCallback(cb.id);
      for (const id of Object.keys(data.status)) if (!data.done.includes(id)) delete data.status[id];
      await closeSection(ctx, messageId, `<b>Se hizo hoy:</b> ${data.done.join(", ") || "nada de la lista"}`);
      return await showStep(ctx, data, nextStep(data, step));
    }
    case "estado/s":
      data.status[value] = extra === "t" ? "terminada" : "avanzó";
      await answerCallback(cb.id);
      return await showStep(ctx, data, step, messageId);
    case "estado/s1": {
      const missing = data.done.filter((id) => !data.status[id]);
      if (missing.length) return await answerCallback(cb.id, `Falta elegir: ${missing.join(", ")}`);
      await answerCallback(cb.id);
      await closeSection(ctx, messageId, `<b>Se hizo hoy:</b> ${escapeHtml(doneText(data))}`);
      return await showStep(ctx, data, nextStep(data, step));
    }
    case "compras/c": {
      await answerCallback(cb.id);
      await editKeyboard(ctx.chatId, messageId);
      return await expenses.start(ctx, {
        flujo: FLOW,
        paso: "compras",
        datos: data as unknown as Record<string, unknown>,
      });
    }
    case "compras/c1":
      await answerCallback(cb.id);
      await editKeyboard(ctx.chatId, messageId);
      return await showStep(ctx, data, nextStep(data, step));
    case "esperado/e": {
      const item = data.expected[Number(value)];
      if (!item) return await answerCallback(cb.id);
      item.arrived = extra === "1";
      await answerCallback(cb.id);
      if (!item.arrived) await notifyMissing(ctx, data, item.label);
      return await showStep(ctx, data, step, messageId);
    }
    case "esperado/e1": {
      if (data.expected.some((e) => e.arrived === undefined)) {
        return await answerCallback(cb.id, "Marca «Llegó» o «No llegó» en cada uno.");
      }
      await answerCallback(cb.id);
      await closeSection(ctx, messageId, `<b>¿Llegó lo esperado hoy?:</b> ${escapeHtml(expectedText(data))}`);
      return await showStep(ctx, data, nextStep(data, step));
    }
    case "agua/w": {
      const choice = WATER[Number(value)];
      if (!choice) return await answerCallback(cb.id);
      await answerCallback(cb.id);
      data.water = choice;
      data.waterDetail = "";
      await closeSection(ctx, messageId, `<b>Agua (Triple A):</b> ${escapeHtml(choice)}`);
      return await showStep(ctx, data, choice === OTHER ? "agua_otro" : nextStep(data, step));
    }
    case "novedades/n": {
      const choice = NEWS[Number(value)];
      if (!choice) return await answerCallback(cb.id);
      await answerCallback(cb.id);
      // «Sin novedad» excluye a las demás.
      data.news = choice === NO_NEWS
        ? (data.news.includes(NO_NEWS) ? [] : [NO_NEWS])
        : toggle(data.news.filter((n) => n !== NO_NEWS), choice);
      return await showStep(ctx, data, step, messageId);
    }
    case "novedades/n1": {
      if (!data.news.length) return await answerCallback(cb.id, "Marca al menos una, o «Sin novedad».");
      await answerCallback(cb.id);
      if (!data.news.includes(OTHER)) data.newsDetail = "";
      await closeSection(ctx, messageId, `<b>Novedades:</b> ${escapeHtml(data.news.join(", "))}`);
      return await showStep(ctx, data, data.news.includes(OTHER) ? "novedades_otro" : nextStep(data, step));
    }
    case "manana/m":
      data.tomorrow = toggle(data.tomorrow, value);
      await answerCallback(cb.id);
      return await showStep(ctx, data, step, messageId);
    case "manana/m1": {
      await answerCallback(cb.id);
      if (!data.tomorrow.includes(OTHER_OPTION.id)) data.tomorrowDetail = "";
      await closeSection(ctx, messageId, `<b>Para mañana se necesita:</b> ${escapeHtml(tomorrowText(data))}`);
      return await showStep(ctx, data, data.tomorrow.includes(OTHER_OPTION.id) ? "manana_otro" : nextStep(data, step));
    }
    case "vista/ok":
      return await saveReport(ctx, session, messageId);
    case "vista/fix":
      await answerCallback(cb.id);
      await editKeyboard(ctx.chatId, messageId, fixKeyboard(data));
      return;
    case "vista/v":
      await answerCallback(cb.id);
      await editKeyboard(ctx.chatId, messageId, PREVIEW_KEYBOARD);
      return;
    case "vista/fx": {
      await answerCallback(cb.id);
      await editKeyboard(ctx.chatId, messageId);
      return await showStep(
        ctx,
        { ...data, fixing: true },
        value === "hecho" && !data.tasks.length ? "compras" : value,
      );
    }
    case "incongruencia/k":
      return await answerConflict(ctx, data, Number(value), extra, messageId);
  }
  await answerCallback(cb.id, "Ese botón ya no está activo.");
}

/** «No llegó»: avisa a Carlos por privado en ese momento (una vez por cosa). */
async function notifyMissing(ctx: Context, data: Data, label: string): Promise<void> {
  if (data.notified.includes(label)) return;
  data.notified.push(label);
  if (ctx.role === "carlos" && ctx.place === "private") return;
  const who = ctx.role === "hermano" ? " Lo reportó tu hermano." : "";
  await sendMessage({ chatId: envNumber("CARLOS_TG_ID") }, `⚠️ Hoy no llegó: ${escapeHtml(label)}.${who}`);
}

// --- Texto o voz ---------------------------------------------------------------

/** Texto o nota de voz del mensaje. Lo largo y las notas de voz los resume Gemini. */
async function noteFromMessage(ctx: Context): Promise<string | null> {
  const m = ctx.message!;
  if (m.voice) {
    const { bytes } = await downloadFile(m.voice.file_id);
    return (await summarizeNote({ mimeType: m.voice.mime_type ?? "audio/ogg", bytes })).summary;
  }
  const text = m.text?.trim();
  if (!text) return null;
  return text.length <= SHORT_NOTE ? text : (await summarizeNote(text)).summary;
}

/** Mensaje mientras hay un reporte abierto en este tema. */
export async function resume(ctx: Context, session: Session<Data>): Promise<void> {
  const data = session.datos;
  const step = session.paso;
  if (step.endsWith("_otro")) {
    const note = await noteFromMessage(ctx);
    if (!note) {
      await ctx.reply("Escribe el texto o manda una nota de voz.");
      return;
    }
    if (step === "agua_otro") data.waterDetail = note;
    if (step === "novedades_otro") data.newsDetail = note;
    if (step === "manana_otro") data.tomorrowDetail = note;
    await say(ctx, data, `Anotado: ${escapeHtml(note)}`);
    return await showStep(ctx, data, nextStep(data, step));
  }
  // Con la vista previa o una pregunta abierta, el texto o la voz es una nota más del día.
  if (step === "vista" || step === "incongruencia") return await receiveNote(ctx, session);
  await ctx.reply("Toca los botones de arriba, o escribe /reporte para empezar de nuevo.");
}

// --- Notas del día --------------------------------------------------------------

async function noteExists(key: string): Promise<boolean> {
  const { Notas } = await readTabs([NOTES]);
  return Notas.some((r) => String(r.mensaje_id) === key);
}

async function recordNote(
  ctx: Context,
  date: string,
  kind: string,
  transcript: string,
  summary: string,
  key: string,
): Promise<void> {
  await appendRow(NOTES, {
    fecha: date,
    hora: bogotaTime(),
    reportado_por: roleLabel(ctx),
    tipo: kind,
    transcripcion: transcript,
    resumen: summary,
    mensaje_id: key,
  });
}

/** Texto o nota de voz en el tema Reportes: va a Notas y se rearma el reporte del día. */
export async function receiveNote(ctx: Context, session?: Session<Data> | null): Promise<void> {
  const m = ctx.message!;
  const text = m.text?.trim() ?? "";
  if (!m.voice && !text) return;
  const key = String(m.message_id);
  // En un reintento (Gemini sin cuota) la nota ya puede estar guardada.
  if (!(await noteExists(key))) {
    let transcript = text;
    let summary = text;
    if (m.voice) {
      const { bytes } = await downloadFile(m.voice.file_id);
      ({ transcript, summary } = await summarizeNote({ mimeType: m.voice.mime_type ?? "audio/ogg", bytes }));
    } else if (text.length > SHORT_NOTE) {
      summary = (await summarizeNote(text)).summary;
    }
    await recordNote(ctx, todayISO(), m.voice ? "voz" : "texto", transcript, summary, key);
  }
  const wait = await ctx.reply("Nota anotada. Armando el reporte del día…");
  await buildFromNotes(ctx, wait.message_id, session?.datos, 0);
}

const reportOptions = (data: Data): ReportOptions => ({
  tasks: data.tasks,
  expected: data.expected.map((e) => e.label),
  water: WATER,
  news: NEWS,
  tomorrow: data.tomorrowOptions.filter((o) => o.id !== OTHER_OPTION.id),
});

/** Arma el reporte con todas las notas de hoy y el reporte guardado (o el borrador con botones). */
async function buildFromNotes(ctx: Context, editId: number, old: Data | undefined, rounds: number): Promise<void> {
  const data = await baseData(ctx);
  const { Notas, Reportes } = await readTabs([NOTES, "Reportes"]);
  const notes: DayNote[] = Notas.filter((r) => cellDate(r.fecha) === data.date).map((r) => ({
    hora: String(r.hora ?? ""),
    quien: String(r.reportado_por ?? ""),
    tipo: String(r.tipo ?? ""),
    texto: String(r.transcripcion ?? ""),
  }));
  const previous: string[] = [];
  const saved = todayReport(Reportes, data.date);
  if (saved?.texto_reporte) previous.push(String(saved.texto_reporte));
  if (old && !old.notes) previous.push(reportText(old, await sheetFacts(old))); // borrador con botones

  applyReport(data, await extractDayReport(notes, previous, reportOptions(data)));
  data.notes = notes.filter((n) => normalize(n.tipo) !== "aclaracion").length;
  data.answered = old?.answered ?? [];
  data.rounds = rounds;
  const open = data.conflictsFound!.filter((c) => !data.answered!.includes(normalize(c.question)));
  delete data.conflictsFound;
  if (open.length && rounds < MAX_ROUNDS) {
    await showStep(ctx, { ...data, conflicts: open, answers: [] }, "incongruencia", editId);
    return;
  }
  await showPreview(ctx, { ...data, warnings: open.map((c) => c.question) }, editId);
}

/** Pasa lo que armó Gemini a los datos del reporte (descarta lo que no está en las listas). */
function applyReport(data: Data, got: FreeReport & { conflicts: Conflict[] }): void {
  const validTask = new Set(data.tasks.map((t) => t.id));
  for (const t of got.tasks) {
    if (!validTask.has(t.id) || data.done.includes(t.id)) continue;
    data.done.push(t.id);
    data.status[t.id] = t.status === "terminada" ? "terminada" : "avanzó";
  }
  for (const e of got.expected) {
    const item = data.expected.find((x) => normalize(x.label) === normalize(e.item));
    if (item) item.arrived = e.arrived;
  }
  data.water = got.water && WATER.includes(got.water) ? got.water : "";
  data.waterDetail = got.water_detail ?? "";
  data.news = got.news.filter((n) => NEWS.includes(n));
  data.newsDetail = got.news_detail ?? "";
  const validTomorrow = new Set(data.tomorrowOptions.map((o) => o.id));
  data.tomorrow = got.tomorrow.filter((id) => validTomorrow.has(id));
  data.tomorrowDetail = got.tomorrow_detail ?? "";
  if (data.tomorrowDetail && !data.tomorrow.includes(OTHER_OPTION.id)) data.tomorrow.push(OTHER_OPTION.id);
  data.conflictsFound = got.conflicts.filter((c) => c.question && c.options.length >= 2);
}

/** Botón de una incongruencia: una versión, o «Mando otra nota». */
async function answerConflict(
  ctx: Context,
  data: Data,
  index: number,
  choice: string,
  messageId: number,
): Promise<void> {
  const cb = ctx.callback!;
  const answers = data.answers ?? [];
  const c = data.conflicts?.[index];
  const option = choice === "n" ? "" : c?.options[Number(choice)];
  if (!c || index !== answers.length || option === undefined) {
    await answerCallback(cb.id, "Ese botón ya no está activo.");
    return;
  }
  await answerCallback(cb.id);
  if (option) {
    answers.push(`${c.question} → ${option}`);
    data.answered = [...(data.answered ?? []), normalize(c.question)];
    await closeSection(ctx, messageId, `${escapeHtml(c.question)}\n✅ ${escapeHtml(option)}`);
  }
  // Las respuestas quedan en Notas como aclaración: así cuentan cada vez que se rearma el reporte.
  const key = `a${messageId}`;
  if (answers.length && (!option || answers.length === data.conflicts!.length) && !(await noteExists(key))) {
    const text = `Aclaración: ${answers.join("; ")}`;
    await recordNote(ctx, data.date, "aclaración", text, text, key);
  }
  if (!option) {
    await closeSection(ctx, messageId, `${escapeHtml(c.question)}\nManda una nota con la aclaración.`);
    await save(ctx, "incongruencia", { ...data, answers, msg: undefined });
    return;
  }
  if (answers.length < data.conflicts!.length) return await showStep(ctx, { ...data, answers }, "incongruencia");
  const wait = await say(ctx, data, "Armando el reporte con la aclaración…");
  await buildFromNotes(ctx, wait, data, (data.rounds ?? 0) + 1);
}

/** Vuelve al reporte después de «Agregar compra» (o de un gasto hecho a mitad del reporte). */
export async function resumeAfterExpense(ctx: Context, back: { paso: string; datos: Record<string, unknown> }) {
  const data = back.datos as unknown as Data;
  await showStep(ctx, data, back.paso);
}

// --- Guardar -------------------------------------------------------------------

async function saveReport(ctx: Context, session: Session<Data>, messageId: number): Promise<void> {
  const cb = ctx.callback!;
  if (!(await claimStep(ctx.chatId, ctx.userId, "vista", "guardando"))) {
    await answerCallback(cb.id, "Ya lo estoy guardando.");
    return;
  }
  await answerCallback(cb.id);
  const data = session.datos;
  let text: string;
  let previous: Row | undefined;
  try {
    const f = await sheetFacts(data);
    text = reportText(data, f);
    const { Tareas, Esperado, Reportes } = await readTabs(["Tareas", "Esperado", "Reportes"]);
    const tasks = readTasks(Tareas);
    previous = todayReport(Reportes, data.date);
    // Una tarea terminada antes de hoy no se toca; si la terminó el reporte de hoy, una corrección la reabre.
    const finishedToday = new Set(idList(previous?.tareas_terminadas));
    await updateCells(
      "Tareas",
      data.done.flatMap((id) => {
        const t = tasks.find((x) => x.id === id);
        if (!t) return [];
        if (data.status[id] === "terminada") return [{ row: t._row, values: { estado: "terminada" } }];
        if (t.estado === "terminada" && !finishedToday.has(id)) return [];
        return [{ row: t._row, values: { estado: "en curso" } }];
      }),
    );
    await updateCells(
      "Esperado",
      data.expected.filter((e) => e.arrived !== undefined).flatMap((e) => {
        const r = Esperado.find((x) =>
          cellDate(x.fecha) === data.date && normalize(x.quien_o_que) === normalize(e.label)
        );
        return r ? [{ row: r._row, values: { llego: e.arrived ? "sí" : "no", confirmado_por: roleLabel(ctx) } }] : [];
      }),
    );
    const terminated = data.done.filter((id) => data.status[id] === "terminada");
    const values = {
      fecha: data.date,
      hora: bogotaTime(),
      reportado_por: roleLabel(ctx),
      tareas_terminadas: terminated.join(","),
      tareas_avanzadas: data.done.filter((id) => !terminated.includes(id)).join(","),
      avance_objetivo_pct: f.objective.total ? Math.round((100 * f.objective.done) / f.objective.total) : "",
      llego_esperado: data.expected.filter((e) => e.arrived === true).map((e) => e.label).join("; "),
      no_llego: data.expected.filter((e) => e.arrived === false).map((e) => e.label).join("; "),
      agua: waterText(data),
      novedades: data.news.filter((n) => n !== OTHER).join(", "),
      novedades_detalle: data.newsDetail,
      para_manana: tomorrowText(data),
      pares_antes_despues: "",
      compras_del_dia: f.purchases.join("; "),
      saldo_caja_menor: f.balance,
      texto_reporte: text,
    };
    if (previous) await updateCells("Reportes", [{ row: previous._row, values }]);
    else await appendRow("Reportes", values);
  } catch (e) {
    await save(ctx, "vista", data);
    throw e;
  }

  await deleteSession(ctx.chatId, ctx.userId);
  const done = previous ? "actualizado" : "guardado";
  await editMessageText(ctx.chatId, messageId, `${escapeHtml(text)}\n\n✅ Reporte ${done}.`);
  // Lo que no llegó y no se avisó con los botones ni en un reporte anterior de hoy se avisa ahora.
  const toldBefore = new Set(String(previous?.no_llego ?? "").split("; ").filter(Boolean));
  for (const e of data.expected.filter((x) => x.arrived === false && !toldBefore.has(x.label))) {
    await notifyMissing(ctx, data, e.label);
  }
  if (!(ctx.role === "carlos" && ctx.place === "private")) {
    const who = ctx.role === "hermano"
      ? `Tu hermano ${previous ? "actualizó" : "guardó"}`
      : previous
      ? "Actualizaste"
      : "Guardaste";
    await sendMessage({ chatId: envNumber("CARLOS_TG_ID") }, `${who} el reporte:\n\n${escapeHtml(text)}`);
  }
}
