// Reporte diario (sección 6.2 del prompt), de dos formas:
// - Con botones (/reporte): por secciones, con selección múltiple.
// - Con notas: cada texto o nota de voz del tema Reportes lo lee Gemini y el bot pregunta «¿Quisiste decir
//   esto?». Con «Sí» la nota va a la pestaña Notas y el bot rearma un solo reporte con todas las del día;
//   con «No» pide una aclaración (texto u otro audio) y vuelve a preguntar.
// El reporte se escribe solo con «Sí, guardar» y hay uno por día: guardarlo otra vez actualiza su fila.
// Al guardar: fila en Reportes, estado en Tareas, llegó en Esperado y el resumen a Carlos por privado.

import { claimStep, deleteSession, readSession, saveSession, type Session } from "../../_shared/db.ts";
import { envNumber } from "../../_shared/env.ts";
import {
  type DayNote,
  extractDayReport,
  readNote,
  type ReportFields,
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
  type Task,
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

type Status = "terminada" | "avanzó";

interface Option {
  id: string;
  label: string;
}

interface Expected {
  label: string;
  arrived?: boolean;
}

/** Nota recibida que espera su turno para la pregunta «¿Quisiste decir esto?». */
interface QueuedNote {
  key: string;
  voice?: string;
  text?: string;
}

/** Nota leída por Gemini, esperando «Sí» o «No». */
interface PendingNote {
  key: string;
  kind: "voz" | "texto";
  transcript: string;
  /** Lo que entendió el bot, tal como se mostró: es lo que se confirma y se guarda. */
  understood: string;
}

interface Data extends FlowBase {
  date: string;
  tasks: Option[];
  done: string[];
  /** Trabajo hecho que no es una tarea del cronograma (sale de las notas). */
  extraWork: string;
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
  /** Armado con las notas del día: cuántas. */
  notes?: number;
  /** Contradicciones entre notas que vio Gemini: se avisan en la vista previa. */
  warnings?: string[];
  /** Nota por confirmar y las que esperan turno. */
  pending?: PendingNote;
  queue?: QueuedNote[];
  /** Borrador con botones sin guardar, para no perderlo si llega una nota. */
  draft?: string;
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
  return (await loadDay(ctx)).data;
}

/** Datos del día y todas las tareas del cronograma, leídos de la hoja en este momento. */
async function loadDay(ctx: Context): Promise<{ data: Data; tasks: Task[] }> {
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
  const data: Data = {
    hilo: ctx.threadId ?? null,
    date,
    tasks: tasks.filter((t) => listed.has(t.id)).map(option),
    done: [],
    extraWork: "",
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
  return { data, tasks };
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
  const tasks = data.done.map((id) => `${id} ${data.status[id] ?? "avanzó"}`).join(", ");
  return [tasks, data.extraWork].filter(Boolean).join("; ") || "nada";
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
    case "nota/q":
    case "aclarar/q":
      return await answerNote(ctx, data, value, messageId);
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
  if (step === "aclarar") return await clarify(ctx, data);
  // Con la vista previa abierta o una nota por confirmar, el texto o la voz es una nota más del día.
  if (step === "vista" || step === "nota") return await receiveNote(ctx, session);
  await ctx.reply("Toca los botones de arriba, o escribe /reporte para empezar de nuevo.");
}

// --- Notas del día --------------------------------------------------------------

async function noteExists(key: string): Promise<boolean> {
  const { Notas } = await readTabs([NOTES]);
  return Notas.some((r) => String(r.mensaje_id) === key);
}

/** Lo que Gemini puede elegir: las tareas sin terminar de todo el cronograma (el trabajo puede ir adelantado
 * o atrasado), más las del reporte de hoy. */
function reportOptions(data: Data, tasks: Task[]): ReportOptions {
  const open = tasks.filter((t) => t.estado !== "terminada" || data.tasks.some((x) => x.id === t.id));
  const when = (t: Task) => t.inicio === t.fin ? shortDate(t.inicio) : `${shortDate(t.inicio)} – ${shortDate(t.fin)}`;
  return {
    tasks: open.map((t) => ({ id: t.id, label: t.tarea, when: t.inicio ? when(t) : undefined })),
    expected: data.expected.map((e) => e.label),
    water: WATER,
    news: NEWS,
    tomorrow: [...open.map((t) => ({ id: t.id, label: t.tarea })), DECISION],
  };
}

/** Lo que entendió de la nota, en frases (es lo que se confirma y se guarda en Notas). */
function readingText(r: ReportFields, options: ReportOptions): string {
  const label = (id: string) => options.tasks.find((t) => t.id === id)?.label;
  const lines: string[] = [];
  for (const t of r.tasks) if (label(t.id)) lines.push(`Se hizo: ${t.id} ${label(t.id)} – ${t.status}`);
  if (r.extra_work) lines.push(`Otro trabajo: ${r.extra_work}`);
  for (const e of r.expected) lines.push(`${e.arrived ? "Llegó" : "No llegó"}: ${e.item}`);
  if (r.water && WATER.includes(r.water)) {
    const detail = r.water_detail ? `: ${r.water_detail}` : "";
    lines.push(`Agua (Triple A): ${r.water === OTHER ? r.water_detail || OTHER : `${r.water}${detail}`}`);
  }
  const news = [...r.news.filter((n) => NEWS.includes(n) && n !== OTHER), ...(r.news_detail ? [r.news_detail] : [])];
  if (news.length) lines.push(`Novedades: ${news.join(", ")}`);
  const tomorrow = r.tomorrow.flatMap((id) =>
    id === DECISION.id ? [DECISION.label] : label(id) ? [`${id} ${label(id)}`] : []
  );
  if (r.tomorrow_detail) tomorrow.push(r.tomorrow_detail);
  if (tomorrow.length) lines.push(`Para mañana: ${tomorrow.join(", ")}`);
  return lines.join("\n");
}

/** Texto o nota de voz en el tema Reportes: Gemini la lee y el bot pregunta si entendió bien. */
export async function receiveNote(ctx: Context, session?: Session<Data> | null): Promise<void> {
  const m = ctx.message!;
  const text = m.text?.trim() ?? "";
  if (!m.voice && !text) return;
  const note: QueuedNote = { key: String(m.message_id), ...(m.voice ? { voice: m.voice.file_id } : { text }) };
  const old = session?.datos;
  if (session?.paso === "nota" && old?.pending) {
    // Ya hay una nota esperando el «Sí» o el «No»: esta espera su turno.
    if (old.pending.key !== note.key && !old.queue?.some((q) => q.key === note.key)) {
      await save(ctx, "nota", { ...old, queue: [...(old.queue ?? []), note] });
    }
    await ctx.reply("Recibida. Primero responde si entendí bien la nota anterior y luego te muestro esta.");
    return;
  }
  // Un borrador con botones sin guardar no se pierde: entra como base del reporte.
  const draft = session?.paso === "vista" && old && !old.notes ? reportText(old, await sheetFacts(old)) : old?.draft;
  await askAboutNote(ctx, note, [], undefined, draft);
}

/** Lee la nota (o su aclaración) con Gemini y pregunta «¿Quisiste decir esto?». */
async function askAboutNote(
  ctx: Context,
  note: QueuedNote,
  queue: QueuedNote[],
  original?: PendingNote,
  draft?: string,
): Promise<void> {
  const wait = await ctx.reply(original ? "Leyendo la aclaración…" : "Leyendo la nota…");
  const { data, tasks } = await loadDay(ctx);
  const options = reportOptions(data, tasks);
  const input = note.voice ? { mimeType: "audio/ogg", bytes: (await downloadFile(note.voice)).bytes } : note.text!;
  const reading = await readNote(input, original?.transcript ?? null, options);
  const heard = note.text ?? reading.transcript;
  const understood = readingText(reading, options);
  const pending: PendingNote = {
    key: original?.key ?? note.key,
    kind: original?.kind ?? (note.voice ? "voz" : "texto"),
    transcript: original ? `${original.transcript}\nAclaración: ${heard}` : heard,
    understood,
  };
  const text = [
    ...(note.voice ? [`Escuché: «${escapeHtml(reading.transcript)}»`, ""] : []),
    "<b>¿Quisiste decir esto?</b>",
    escapeHtml(understood || "No encontré nada para el reporte."),
  ].join("\n");
  await editMessageText(ctx.chatId, wait.message_id, text, [[button("Sí", "rep:q:1"), button("No", "rep:q:0")]]);
  await save(ctx, "nota", { ...data, pending, queue, draft, msg: wait.message_id });
}

/** «Sí», «No» o «Descartar nota» sobre la nota que se está confirmando. */
async function answerNote(ctx: Context, data: Data, choice: string, messageId: number): Promise<void> {
  const cb = ctx.callback!;
  const pending = data.pending;
  if (!pending) return await answerCallback(cb.id, "Ese botón ya no está activo.");
  await answerCallback(cb.id);
  const understood = pending.understood;

  if (choice === "0") {
    await editMessageText(ctx.chatId, messageId, `${escapeHtml(understood || "—")}\n\nNo era eso.`);
    const m = await say(ctx, data, "¿Quieres aclarar con texto u otro audio? Mándalo aquí.", [[
      button("Descartar la nota", "rep:q:x"),
    ]]);
    await save(ctx, "aclarar", { ...data, msg: m });
    return;
  }
  if (choice === "x") {
    await editMessageText(ctx.chatId, messageId, "Nota descartada.");
  } else {
    // En un reintento (Gemini sin cuota al armar el reporte) la nota ya puede estar guardada.
    if (!(await noteExists(pending.key))) {
      await appendRow(NOTES, {
        fecha: data.date,
        hora: bogotaTime(),
        reportado_por: roleLabel(ctx),
        tipo: pending.kind,
        transcripcion: pending.transcript,
        resumen: understood,
        mensaje_id: pending.key,
      });
    }
    await editMessageText(ctx.chatId, messageId, `✅ Nota guardada:\n${escapeHtml(understood || "—")}`);
  }
  const [next, ...rest] = data.queue ?? [];
  if (next) return await askAboutNote(ctx, next, rest, undefined, data.draft);
  const { Notas } = await readTabs([NOTES]);
  if (!Notas.some((r) => cellDate(r.fecha) === data.date)) {
    await deleteSession(ctx.chatId, ctx.userId);
    return;
  }
  const wait = await say(ctx, data, "Armando el reporte del día…");
  await buildFromNotes(ctx, wait, data.draft);
}

/** Aclaración (texto u otro audio) de la nota que no se entendió bien. */
async function clarify(ctx: Context, data: Data): Promise<void> {
  const m = ctx.message!;
  const text = m.text?.trim() ?? "";
  if (!data.pending || (!m.voice && !text)) {
    await ctx.reply("Manda la aclaración en texto o en una nota de voz.");
    return;
  }
  if (data.msg) await editKeyboard(ctx.chatId, data.msg);
  const clarification: QueuedNote = { key: String(m.message_id), ...(m.voice ? { voice: m.voice.file_id } : { text }) };
  await askAboutNote(ctx, clarification, data.queue ?? [], data.pending, data.draft);
}

/** Arma el reporte con todas las notas confirmadas de hoy y el reporte guardado. */
async function buildFromNotes(ctx: Context, editId: number, draft?: string): Promise<void> {
  const { data, tasks } = await loadDay(ctx);
  const { Notas, Reportes } = await readTabs([NOTES, "Reportes"]);
  const notes: DayNote[] = Notas.filter((r) => cellDate(r.fecha) === data.date).map((r) => ({
    hora: String(r.hora ?? ""),
    quien: String(r.reportado_por ?? ""),
    texto: String(r.resumen || r.transcripcion || ""),
  }));
  const saved = todayReport(Reportes, data.date);
  const previous = [saved?.texto_reporte, draft].filter((p): p is string => Boolean(p)).map(String);
  const options = reportOptions(data, tasks);
  const got = await extractDayReport(notes, previous, options);
  applyReport(data, got, options);
  await showPreview(ctx, { ...data, notes: notes.length, warnings: got.warnings ?? [] }, editId);
}

/** Pasa lo que armó Gemini a los datos del reporte (descarta lo que no está en las listas). */
function applyReport(data: Data, got: ReportFields, options: ReportOptions): void {
  const label = (id: string) => options.tasks.find((t) => t.id === id)?.label;
  for (const t of got.tasks) {
    const name = label(t.id);
    if (!name || data.done.includes(t.id)) continue;
    if (!data.tasks.some((x) => x.id === t.id)) data.tasks.push({ id: t.id, label: name });
    data.done.push(t.id);
    data.status[t.id] = t.status === "terminada" ? "terminada" : "avanzó";
  }
  data.extraWork = got.extra_work ?? "";
  for (const e of got.expected) {
    const item = data.expected.find((x) => normalize(x.label) === normalize(e.item));
    if (item) item.arrived = e.arrived;
  }
  data.water = got.water && WATER.includes(got.water) ? got.water : "";
  data.waterDetail = got.water_detail ?? "";
  data.news = got.news.filter((n) => NEWS.includes(n));
  data.newsDetail = got.news_detail ?? "";
  data.tomorrow = [];
  for (const id of got.tomorrow) {
    const name = id === DECISION.id ? DECISION.label : label(id);
    if (!name || data.tomorrow.includes(id)) continue;
    if (!data.tomorrowOptions.some((o) => o.id === id)) data.tomorrowOptions.splice(-2, 0, { id, label: name });
    data.tomorrow.push(id);
  }
  data.tomorrowDetail = got.tomorrow_detail ?? "";
  if (data.tomorrowDetail && !data.tomorrow.includes(OTHER_OPTION.id)) data.tomorrow.push(OTHER_OPTION.id);
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
