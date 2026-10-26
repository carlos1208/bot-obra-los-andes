// Reporte diario en el tema Reportes, en un solo flujo:
// 1. Cada texto o nota de voz lo lee Gemini y el bot pregunta «¿Quisiste decir esto?». Con «Sí» la nota va a
//    la pestaña Notas; con «No» pide una aclaración (texto u otro audio) y vuelve a preguntar.
// 2. Con cada nota confirmada, el bot muestra el resumen del día (todas las notas) y «Cerrar el reporte».
// 3. Al cerrar: lista numerada de las tareas pendientes por sección; el usuario responde «2-5». Luego lo
//    esperado de hoy (llegó / no llegó), y la vista previa con el avance de la obra contra el cronograma.
// El reporte se escribe solo con «Sí, guardar» y hay uno por día: guardarlo otra vez actualiza su fila.
// Al guardar: fila en Reportes, estado en Tareas, llegó en Esperado y el resumen a Carlos por privado.

import { claimStep, deleteSession, readSession, saveSession, type Session } from "../../_shared/db.ts";
import { envNumber } from "../../_shared/env.ts";
import { readNote, summarizeDay } from "../../_shared/extractors.ts";
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
  nextTasks,
  parseTaskIds,
  pettyCashBalance,
  readConfig,
  readTasks,
  type Row,
  scheduleProgress,
  type Task,
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
import { button, type FlowBase, isActiveButton, roleLabel, short } from "../ui.ts";
import * as expenses from "./expenses.ts";

/** Valor de sesiones.flujo para este flujo. */
export const FLOW = "reporte";
/** Pestaña de las notas del día. */
const NOTES = "Notas";
/** Mensajes de Telegram: máximo 4096 caracteres; la lista de tareas se parte antes. */
const MAX_MESSAGE = 3500;

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

interface Expected {
  label: string;
  arrived?: boolean;
}

interface Data extends FlowBase {
  date: string;
  /** Resumen del día armado con las notas confirmadas. */
  summary?: string;
  notes?: number;
  warnings?: string[];
  /** Tareas que se terminaron (ids del cronograma). Viene del reporte guardado hoy, si hay. */
  finished?: string[];
  expected: Expected[];
  /** «No llegó» que ya se avisaron a Carlos. */
  notified: string[];
  /** Nota por confirmar y las que esperan turno. */
  pending?: PendingNote;
  queue?: QueuedNote[];
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

/** Fila de hoy en Reportes (hay una por día). */
function todayReport(rows: Row[], date: string): Row | undefined {
  return rows.filter((r) => cellDate(r.fecha) === date).at(-1);
}

const idList = (v: unknown) => String(v ?? "").split(/[-,;\s]+/).filter(Boolean);

/** Datos del día leídos de la hoja en este momento. Lo ya guardado hoy viene marcado. */
async function baseData(ctx: Context): Promise<Data> {
  const date = todayISO();
  const { Esperado, Reportes } = await readTabs(["Esperado", "Reportes"]);
  const saved = todayReport(Reportes, date);
  return {
    hilo: ctx.threadId ?? null,
    date,
    finished: saved ? idList(saved.tareas_terminadas) : undefined,
    expected: Esperado.filter((r) => cellDate(r.fecha) === date).map((r) => {
      const llego = normalize(r.llego);
      return { label: String(r.quien_o_que), arrived: llego === "si" ? true : llego === "no" ? false : undefined };
    }),
    notified: [],
  };
}

async function hasNotesToday(date: string): Promise<boolean> {
  const { Notas } = await readTabs([NOTES]);
  return Notas.some((r) => cellDate(r.fecha) === date);
}

/** /reporte: muestra el resumen del día o pide contarlo. */
export async function start(ctx: Context): Promise<void> {
  if (ctx.place !== "reports") {
    await ctx.reply("El reporte se hace en el tema Reportes.");
    return;
  }
  const data = await baseData(ctx);
  if (!(await hasNotesToday(data.date))) {
    await deleteSession(ctx.chatId, ctx.userId);
    await ctx.reply("Cuéntame qué se hizo hoy, en texto o en una nota de voz.");
    return;
  }
  const wait = await ctx.reply("Armando el resumen del día…");
  await showSummary(ctx, data, wait.message_id);
}

// --- Notas -----------------------------------------------------------------------

async function noteExists(key: string): Promise<boolean> {
  const { Notas } = await readTabs([NOTES]);
  return Notas.some((r) => String(r.mensaje_id) === key);
}

function noteOf(ctx: Context): QueuedNote | null {
  const m = ctx.message!;
  const text = m.text?.trim() ?? "";
  if (!m.voice && !text) return null;
  return { key: String(m.message_id), ...(m.voice ? { voice: m.voice.file_id } : { text }) };
}

/** Texto o nota de voz en el tema Reportes: Gemini la lee y el bot pregunta si entendió bien. */
export async function receiveNote(ctx: Context, session?: Session<Data> | null): Promise<void> {
  const note = noteOf(ctx);
  if (!note) return;
  const old = session?.datos;
  if (session?.paso === "nota" && old?.pending) {
    // Ya hay una nota esperando el «Sí» o el «No»: esta espera su turno.
    if (old.pending.key !== note.key && !old.queue?.some((q) => q.key === note.key)) {
      await save(ctx, "nota", { ...old, queue: [...(old.queue ?? []), note] });
    }
    await ctx.reply("Recibida. Primero responde si entendí bien la nota anterior y luego te muestro esta.");
    return;
  }
  await askAboutNote(ctx, note, []);
}

/** Lee la nota (o su aclaración) con Gemini y pregunta «¿Quisiste decir esto?». */
async function askAboutNote(ctx: Context, note: QueuedNote, queue: QueuedNote[], original?: PendingNote) {
  const wait = await ctx.reply(original ? "Leyendo la aclaración…" : "Leyendo la nota…");
  const input = note.voice ? { mimeType: "audio/ogg", bytes: (await downloadFile(note.voice)).bytes } : note.text!;
  const got = await readNote(input, original?.transcript ?? null);
  const heard = note.text ?? got.transcript;
  const pending: PendingNote = {
    key: original?.key ?? note.key,
    kind: original?.kind ?? (note.voice ? "voz" : "texto"),
    transcript: original ? `${original.transcript}\nAclaración: ${heard}` : heard,
    understood: got.summary,
  };
  const text = [
    ...(note.voice ? [`Escuché: «${escapeHtml(got.transcript)}»`, ""] : []),
    "<b>¿Quisiste decir esto?</b>",
    escapeHtml(got.summary || "No entendí la nota."),
  ].join("\n");
  await editMessageText(ctx.chatId, wait.message_id, text, [[button("Sí", "rep:q:1"), button("No", "rep:q:0")]]);
  await save(ctx, "nota", { ...(await baseData(ctx)), pending, queue, msg: wait.message_id });
}

/** «Sí», «No» o «Descartar la nota» sobre la nota que se está confirmando. */
async function answerNote(ctx: Context, data: Data, choice: string, messageId: number): Promise<void> {
  const cb = ctx.callback!;
  const pending = data.pending;
  if (!pending) return await answerCallback(cb.id, "Ese botón ya no está activo.");
  await answerCallback(cb.id);

  if (choice === "0") {
    await editMessageText(ctx.chatId, messageId, `${escapeHtml(pending.understood || "—")}\n\nNo era eso.`);
    const m = await say(ctx, data, "¿Quieres aclarar con texto u otro audio? Mándalo aquí.", [[
      button("Descartar la nota", "rep:q:x"),
    ]]);
    await save(ctx, "aclarar", { ...data, msg: m });
    return;
  }
  if (choice === "x") {
    await editMessageText(ctx.chatId, messageId, "Nota descartada.");
  } else {
    // En un reintento (Gemini sin cuota al resumir el día) la nota ya puede estar guardada.
    if (!(await noteExists(pending.key))) {
      await appendRow(NOTES, {
        fecha: data.date,
        hora: bogotaTime(),
        reportado_por: roleLabel(ctx),
        tipo: pending.kind,
        transcripcion: pending.transcript,
        resumen: pending.understood,
        mensaje_id: pending.key,
      });
    }
    await editMessageText(ctx.chatId, messageId, `✅ Nota guardada:\n${escapeHtml(pending.understood)}`);
  }
  const [next, ...rest] = data.queue ?? [];
  if (next) return await askAboutNote(ctx, next, rest);
  if (!(await hasNotesToday(data.date))) {
    await deleteSession(ctx.chatId, ctx.userId);
    return;
  }
  await showSummary(ctx, data, await say(ctx, data, "Armando el resumen del día…"));
}

/** Aclaración (texto u otro audio) de la nota que no se entendió bien. */
async function clarify(ctx: Context, data: Data): Promise<void> {
  const note = noteOf(ctx);
  if (!data.pending || !note) {
    await ctx.reply("Manda la aclaración en texto o en una nota de voz.");
    return;
  }
  if (data.msg) await editKeyboard(ctx.chatId, data.msg);
  await askAboutNote(ctx, note, data.queue ?? [], data.pending);
}

// --- Resumen del día ----------------------------------------------------------------

/** Resumen con todas las notas confirmadas de hoy y el botón para cerrar (o actualizar) el reporte. */
async function showSummary(ctx: Context, old: Data, editId: number): Promise<void> {
  const data = { ...(await baseData(ctx)), hilo: old.hilo ?? ctx.threadId ?? null };
  const { Notas } = await readTabs([NOTES]);
  const notes = Notas.filter((r) => cellDate(r.fecha) === data.date).map((r) => ({
    hora: String(r.hora ?? ""),
    texto: String(r.resumen || r.transcripcion || ""),
  }));
  const got = await summarizeDay(notes);
  data.summary = got.summary;
  data.notes = notes.length;
  data.warnings = got.warnings ?? [];
  const saved = data.finished !== undefined;
  const text = [
    `<b>Resumen del día – ${shortDate(data.date)}</b> (${notes.length} nota${notes.length > 1 ? "s" : ""})`,
    escapeHtml(data.summary),
    ...data.warnings.map((w) => `⚠️ Revisa: ${escapeHtml(w)}`),
    "",
    saved
      ? "El reporte de hoy ya está guardado. Actualízalo para sumar esta nota."
      : "Manda más notas si falta algo. Al terminar el día, cierra el reporte.",
  ].join("\n");
  const label = saved ? "Actualizar el reporte" : "Cerrar el reporte";
  await editMessageText(ctx.chatId, editId, text, [[button(label, "rep:cerrar")]]);
  await save(ctx, "resumen", { ...data, msg: editId });
}

// --- Tareas terminadas ----------------------------------------------------------------

/** Tareas para la lista: las pendientes y las que el reporte de hoy ya marcó como terminadas. */
function listedTasks(tasks: Task[], data: Data): Task[] {
  return tasks.filter((t) => t.estado !== "terminada" || data.finished?.includes(t.id));
}

/** Lista numerada por sección (fase del cronograma), partida en mensajes que caben en Telegram. */
function taskListMessages(tasks: Task[], data: Data): string[] {
  const messages = [
    "<b>¿Qué tareas se terminaron hoy?</b>\nResponde con los números separados por guion, por ejemplo: 2-5. " +
    "⏰ = atrasada.",
  ];
  // Cada sección en un solo bloque, en el orden en que aparece en el cronograma.
  const phases = new Map<string, Task[]>();
  for (const t of tasks) phases.set(t.fase, [...(phases.get(t.fase) ?? []), t]);
  for (const [phase, list] of phases) {
    list.forEach((t, i) => {
      const marks = `${t.fin < data.date ? " ⏰" : ""}${data.finished?.includes(t.id) ? " ✔ marcada hoy" : ""}`;
      const line = `${t.id} ${escapeHtml(short(t.tarea, 60))}${marks}`;
      const chunk = i === 0 ? `\n<b>${escapeHtml(phase)}</b>\n${line}` : line;
      if (messages[messages.length - 1].length + chunk.length + 1 > MAX_MESSAGE) messages.push(chunk.trimStart());
      else messages[messages.length - 1] += `\n${chunk}`;
    });
  }
  return messages;
}

async function askTasks(ctx: Context, data: Data): Promise<void> {
  const { Tareas } = await readTabs(["Tareas"]);
  const list = taskListMessages(listedTasks(readTasks(Tareas), data), data);
  const keyboard: Keyboard = [[button("Ninguna", "rep:t:no")]];
  if (data.finished?.length) keyboard[0].push(button(`Dejar las mismas (${data.finished.join("-")})`, "rep:t:igual"));
  let msg = 0;
  for (const [i, text] of list.entries()) {
    msg = await say(ctx, data, text, i === list.length - 1 ? keyboard : undefined);
  }
  await save(ctx, "tareas", { ...data, msg });
}

/** Números escritos en respuesta a la lista: «2-5» (los espacios no importan). */
async function receiveTaskNumbers(ctx: Context, data: Data): Promise<void> {
  const text = ctx.message!.text?.trim() ?? "";
  if (!text) {
    await ctx.reply("Escribe los números de las tareas terminadas, por ejemplo 2-5, o toca «Ninguna».");
    return;
  }
  if (["0", "ninguna", "ninguno", "nada"].includes(normalize(text))) {
    if (data.msg) await editKeyboard(ctx.chatId, data.msg);
    return await tasksChosen(ctx, data, []);
  }
  const { Tareas } = await readTabs(["Tareas"]);
  const tasks = listedTasks(readTasks(Tareas), data);
  const { ids, unknown } = parseTaskIds(text, tasks.map((t) => t.id));
  if (unknown.length || !ids.length) {
    const which = unknown.length ? ` No encontré entre las pendientes: ${escapeHtml(unknown.join(", "))}.` : "";
    await ctx.reply(`No entendí los números.${which} Escribe por ejemplo 2-5, o toca «Ninguna».`);
    return;
  }
  if (data.msg) await editKeyboard(ctx.chatId, data.msg);
  const names = ids.map((id) => `${id} ${escapeHtml(tasks.find((t) => t.id === id)!.tarea)}`);
  const m = await say(
    ctx,
    data,
    `Entendí que se terminaron (${ids.join("-")}):\n${names.join("\n")}\n\n¿Es correcto?`,
    [[
      button("Sí", "rep:t:ok"),
      button("No, escribir de nuevo", "rep:t:otra"),
    ]],
  );
  await save(ctx, "tareas_ok", { ...data, finished: ids, msg: m });
}

/** Con las tareas elegidas: lo esperado de hoy (si falta marcar algo) o la vista previa. */
async function tasksChosen(ctx: Context, data: Data, finished: string[]): Promise<void> {
  const next = { ...data, finished };
  if (next.expected.some((e) => e.arrived === undefined)) return await showExpected(ctx, next);
  await showPreview(ctx, next);
}

// --- Lo esperado ---------------------------------------------------------------------

async function showExpected(ctx: Context, data: Data, editId?: number): Promise<void> {
  const text = ["<b>¿Llegó lo esperado hoy?</b>", ...data.expected.map((e, i) => `${i + 1}. ${escapeHtml(e.label)}`)]
    .join("\n");
  const keyboard: Keyboard = [
    ...data.expected.map((e, i) => [
      button(`${e.arrived === true ? "✅ " : ""}${i + 1} Llegó`, `rep:e:${i}:1`),
      button(`${e.arrived === false ? "❌ " : ""}${i + 1} No llegó`, `rep:e:${i}:0`),
    ]),
    [button("Listo", "rep:e:fin")],
  ];
  let msg = editId;
  if (editId) await editMessageText(ctx.chatId, editId, text, keyboard);
  else msg = await say(ctx, data, text, keyboard);
  await save(ctx, "esperado", { ...data, msg });
}

/** «No llegó»: avisa a Carlos por privado en ese momento (una vez por cosa). */
async function notifyMissing(ctx: Context, data: Data, label: string): Promise<void> {
  if (data.notified.includes(label)) return;
  data.notified.push(label);
  const who = ctx.role === "hermano" ? " Lo reportó tu hermano." : "";
  await sendMessage({ chatId: envNumber("CARLOS_TG_ID") }, `⚠️ Hoy no llegó: ${escapeHtml(label)}.${who}`);
}

// --- Vista previa ----------------------------------------------------------------------

const signed = (n: number) => n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0";

/** «• Obra: 12 % (debería ir en 15 %; desvío −3 %)». */
function progressLine(label: string, p: { actual: number; expected: number }): string {
  const actual = Math.round(p.actual);
  const expected = Math.round(p.expected);
  return `• ${label}: ${actual} % (debería ir en ${expected} %; desvío ${signed(actual - expected)} %)`;
}

/** Lo que se lee de la hoja en este momento para el reporte. */
async function sheetFacts(data: Data) {
  const { Config, Tareas, Gastos, Pagos, Reportes } = await readTabs([
    "Config",
    "Tareas",
    "Gastos",
    "Pagos",
    "Reportes",
  ]);
  const cfg = readConfig(Config);
  const tasks = readTasks(Tareas);
  const finished = data.finished ?? [];
  // Si el reporte de hoy marcó una tarea y ahora no está marcada, no cuenta como terminada.
  const savedToday = idList(todayReport(Reportes, data.date)?.tareas_terminadas);
  const current = tasks.map((t) =>
    savedToday.includes(t.id) && !finished.includes(t.id) ? { ...t, estado: "pendiente" } : t
  );
  const next = nextTasks(current, finished);
  // Fases: las de lo que se terminó hoy y, si no hay, las de lo que sigue.
  const phases = [...new Set(tasks.filter((t) => finished.includes(t.id)).map((t) => t.fase))];
  if (!phases.length) phases.push(...new Set(next.map((t) => t.fase)));
  return {
    tasks,
    progress: scheduleProgress(current, data.date, cfg, finished),
    phases: phases.slice(0, 3).map((phase) => ({
      phase,
      progress: scheduleProgress(current.filter((t) => t.fase === phase), data.date, cfg, finished),
    })),
    next,
    purchases: Gastos
      .filter((r) => cellDate(r.fecha) === data.date)
      .map((r) => `${short(String(r.items ?? ""), 40)} en ${r.proveedor || "—"}, ${formatPesos(cellNumber(r.valor))}`),
    balance: pettyCashBalance(cfg, Gastos, Pagos),
    saved: savedToday.length > 0 || Boolean(todayReport(Reportes, data.date)),
  };
}

type Facts = Awaited<ReturnType<typeof sheetFacts>>;

function expectedLines(data: Data): string[] {
  if (!data.expected.length) return ["Nada esperado hoy."];
  return data.expected.map((e) => `${e.arrived === false ? "❌ No llegó" : "✅ Llegó"}: ${e.label}`);
}

const userName = (ctx: Context) => (ctx.callback?.from ?? ctx.message?.from)?.first_name || roleLabel(ctx);

/** Secciones del reporte: título y líneas (una tarea o compra por línea). */
function reportSections(ctx: Context, data: Data, f: Facts): { title: string; lines: string[] }[] {
  const finished = data.finished ?? [];
  const name = (id: string) => `${id} ${f.tasks.find((t) => t.id === id)?.tarea ?? ""}`.trim();
  return [
    { title: "Resumen del día", lines: (data.summary || "—").split("\n") },
    finished.length
      ? { title: `Tareas terminadas según ${userName(ctx)}`, lines: finished.map((id) => `• ${name(id)}`) }
      : { title: "Tareas terminadas", lines: ["Ninguna hoy."] },
    {
      title: "Avance contra el cronograma",
      lines: [progressLine("Obra", f.progress), ...f.phases.map((p) => progressLine(p.phase, p.progress))],
    },
    { title: "Se espera que continúen con", lines: f.next.length ? f.next.map((t) => `• ${name(t.id)}`) : ["—"] },
    {
      title: "Compras",
      lines: [
        ...(f.purchases.length ? f.purchases.map((p) => `• ${p}`) : ["Ninguna."]),
        `Caja menor: ${formatPesos(f.balance)}`,
      ],
    },
    { title: "¿Llegó lo esperado hoy?", lines: expectedLines(data) },
    { title: "Fotos", lines: ["—"] },
  ];
}

/** El reporte en HTML para Telegram (títulos en negrilla) o en texto plano para la hoja. */
function reportText(ctx: Context, data: Data, f: Facts, html = false): string {
  const bold = (s: string) => html ? `<b>${escapeHtml(s)}</b>` : s;
  const plain = (s: string) => html ? escapeHtml(s) : s;
  return [
    bold(`REPORTE – ${shortDate(data.date)}`),
    ...reportSections(ctx, data, f).flatMap((s) => ["", bold(s.title), ...s.lines.map(plain)]),
  ].join("\n");
}

function previewKeyboard(data: Data): Keyboard {
  return [
    [button("Sí, guardar", "rep:ok"), button("Corregir tareas", "rep:fix:t")],
    ...(data.expected.length ? [[button("Corregir lo esperado", "rep:fix:e")]] : []),
    [button("Agregar compra", "rep:compra"), button("Cancelar", "rep:x")],
  ];
}

async function showPreview(ctx: Context, data: Data): Promise<void> {
  const f = await sheetFacts(data);
  const question = f.saved ? "Ya hay un reporte de hoy. ¿Lo actualizo con este?" : "¿Lo guardo?";
  const msg = await say(ctx, data, `${reportText(ctx, data, f, true)}\n\n${question}`, previewKeyboard(data));
  await save(ctx, "vista", { ...data, msg });
}

// --- Botones «rep:…» -------------------------------------------------------------------

export async function onButton(ctx: Context): Promise<void> {
  const cb = ctx.callback!;
  const session = await readSession<Data>(ctx.chatId, ctx.userId);
  if (!session || session.flujo !== FLOW || !isActiveButton(session, ctx)) {
    await answerCallback(cb.id, "Ese botón ya no está activo.");
    return;
  }
  const data = session.datos;
  const messageId = cb.message!.message_id;
  const [, action, value, extra] = (cb.data ?? "").split(":");

  if (action === "x") {
    await answerCallback(cb.id);
    await deleteSession(ctx.chatId, ctx.userId);
    await editMessageText(ctx.chatId, messageId, "Reporte cancelado. No guardé nada; las notas siguen en la hoja.");
    return;
  }
  switch (`${session.paso}/${action}`) {
    case "nota/q":
    case "aclarar/q":
      return await answerNote(ctx, data, value, messageId);
    case "resumen/cerrar":
      await answerCallback(cb.id);
      await editKeyboard(ctx.chatId, messageId);
      return await askTasks(ctx, data);
    case "tareas/t":
      await answerCallback(cb.id);
      await editKeyboard(ctx.chatId, messageId);
      return await tasksChosen(ctx, data, value === "igual" ? data.finished ?? [] : []);
    case "tareas_ok/t":
      await answerCallback(cb.id);
      await editKeyboard(ctx.chatId, messageId);
      if (value === "otra") return await askTasks(ctx, data);
      return await tasksChosen(ctx, data, data.finished ?? []);
    case "esperado/e": {
      if (value === "fin") {
        if (data.expected.some((e) => e.arrived === undefined)) {
          return await answerCallback(cb.id, "Marca «Llegó» o «No llegó» en cada uno.");
        }
        await answerCallback(cb.id);
        await editKeyboard(ctx.chatId, messageId);
        return await showPreview(ctx, data);
      }
      const item = data.expected[Number(value)];
      if (!item) return await answerCallback(cb.id);
      item.arrived = extra === "1";
      await answerCallback(cb.id);
      if (!item.arrived) await notifyMissing(ctx, data, item.label);
      return await showExpected(ctx, data, messageId);
    }
    case "vista/ok":
      return await saveReport(ctx, session, messageId);
    case "vista/fix":
      await answerCallback(cb.id);
      await editKeyboard(ctx.chatId, messageId);
      return value === "e" ? await showExpected(ctx, data) : await askTasks(ctx, data);
    case "vista/compra":
      await answerCallback(cb.id);
      await editKeyboard(ctx.chatId, messageId);
      return await expenses.start(ctx, {
        flujo: FLOW,
        paso: "vista",
        datos: data as unknown as Record<string, unknown>,
      });
  }
  await answerCallback(cb.id, "Ese botón ya no está activo.");
}

/** Mensaje mientras hay un reporte abierto en este tema. */
export async function resume(ctx: Context, session: Session<Data>): Promise<void> {
  switch (session.paso) {
    case "aclarar":
      return await clarify(ctx, session.datos);
    case "tareas":
      return await receiveTaskNumbers(ctx, session.datos);
    case "nota":
    case "resumen":
    case "vista":
      // Una nota más del día.
      return await receiveNote(ctx, session);
  }
  await ctx.reply("Toca los botones de arriba, o escribe /reporte para empezar de nuevo.");
}

/** Vuelve al reporte después de «Agregar compra» (o de un gasto hecho a mitad del reporte). */
export async function resumeAfterExpense(ctx: Context, back: { paso: string; datos: Record<string, unknown> }) {
  const data = back.datos as unknown as Data;
  if (back.paso === "vista") return await showPreview(ctx, data);
  await save(ctx, back.paso, data);
  await say(ctx, data, "Listo. Sigue con el reporte arriba.");
}

// --- Guardar -------------------------------------------------------------------------

async function saveReport(ctx: Context, session: Session<Data>, messageId: number): Promise<void> {
  const cb = ctx.callback!;
  if (!(await claimStep(ctx.chatId, ctx.userId, "vista", "guardando"))) {
    await answerCallback(cb.id, "Ya lo estoy guardando.");
    return;
  }
  await answerCallback(cb.id);
  const data = session.datos;
  const finished = data.finished ?? [];
  let text: string;
  let html: string;
  let previous: Row | undefined;
  try {
    const f = await sheetFacts(data);
    text = reportText(ctx, data, f);
    html = reportText(ctx, data, f, true);
    const { Tareas, Esperado, Reportes } = await readTabs(["Tareas", "Esperado", "Reportes"]);
    const tasks = readTasks(Tareas);
    previous = todayReport(Reportes, data.date);
    const row = (id: string) => tasks.find((t) => t.id === id)?._row;
    // Una tarea que marcó el reporte de hoy y ya no está marcada vuelve a pendiente.
    const unmarked = idList(previous?.tareas_terminadas).filter((id) => !finished.includes(id));
    await updateCells("Tareas", [
      ...finished.flatMap((id) => row(id) ? [{ row: row(id)!, values: { estado: "terminada" } }] : []),
      ...unmarked.flatMap((id) => row(id) ? [{ row: row(id)!, values: { estado: "pendiente" } }] : []),
    ]);
    await updateCells(
      "Esperado",
      data.expected.filter((e) => e.arrived !== undefined).flatMap((e) => {
        const r = Esperado.find((x) =>
          cellDate(x.fecha) === data.date && normalize(x.quien_o_que) === normalize(e.label)
        );
        return r ? [{ row: r._row, values: { llego: e.arrived ? "sí" : "no", confirmado_por: roleLabel(ctx) } }] : [];
      }),
    );
    const actual = Math.round(f.progress.actual);
    const expected = Math.round(f.progress.expected);
    const values = {
      fecha: data.date,
      hora: bogotaTime(),
      reportado_por: roleLabel(ctx),
      resumen_del_dia: data.summary ?? "",
      tareas_terminadas: finished.join("-"),
      avance_obra_pct: actual,
      avance_esperado_pct: expected,
      desvio_pct: actual - expected,
      llego_esperado: data.expected.filter((e) => e.arrived === true).map((e) => e.label).join("; "),
      no_llego: data.expected.filter((e) => e.arrived === false).map((e) => e.label).join("; "),
      para_continuar: f.next.map((t) => t.id).join("-"),
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
  await editMessageText(
    ctx.chatId,
    messageId,
    `${html}\n\n✅ Reporte ${previous ? "actualizado" : "guardado"}.`,
  );
  if (!(ctx.role === "carlos" && ctx.place === "private")) {
    const who = ctx.role === "hermano"
      ? `Tu hermano ${previous ? "actualizó" : "guardó"}`
      : previous
      ? "Actualizaste"
      : "Guardaste";
    await sendMessage({ chatId: envNumber("CARLOS_TG_ID") }, `${who} el reporte:\n\n${html}`);
  }
}
