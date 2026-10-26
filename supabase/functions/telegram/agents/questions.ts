// Preguntas libres por privado (Carlos y su hermano). Lee en este momento solo las pestañas que la pregunta
// necesita y le pasa a Gemini esos datos para redactar la respuesta, que termina con «Dato de la hoja, hh:mm».
// Respeta hermano_ve_dinero: pagos, valores de hitos y presupuesto solo los ve Carlos en su privado.

import { answerQuestion, type PrivateMessage, type Topic } from "../../_shared/extractors.ts";
import { bogotaTime, cellDate, escapeHtml, formatPesos, shortDate, todayISO } from "../../_shared/format.ts";
import { readTabs } from "../../_shared/sheets.ts";
import {
  available12M,
  type Config,
  masonPaid,
  pettyCashBalance,
  readConfig,
  readTasks,
  type Row,
  tasksForWeek,
  weekRange,
  workWeek,
} from "../../_shared/site.ts";
import { editMessageText } from "../../_shared/telegram.ts";
import { canSeeMoney, type Context } from "../context.ts";

type Tab =
  | "Tareas"
  | "Objetivos"
  | "Esperado"
  | "Hitos"
  | "Pagos"
  | "Presupuesto"
  | "Gastos"
  | "Productos"
  | "Reportes"
  | "Notas";

/** Pestañas que se leen para cada tema. */
const TABS: Record<Topic, Tab[]> = {
  cronograma: ["Tareas"],
  objetivos: ["Objetivos"],
  esperado: ["Esperado"],
  hitos: ["Hitos"],
  pagos: ["Pagos", "Hitos"],
  presupuesto: ["Presupuesto", "Gastos", "Pagos"],
  compras: ["Gastos", "Productos", "Pagos"],
  reportes: ["Reportes", "Notas"],
};

/** Temas de dinero (sección 3, regla 4). */
const MONEY_TOPICS: Topic[] = ["pagos", "presupuesto"];
/** Columnas de Hitos que son dinero. */
const MILESTONE_MONEY = new Set(["valor", "descuento", "valor_a_pagar", "pagado", "fecha_pago"]);
const DATE_COLUMNS = new Set([
  "fecha",
  "inicio",
  "fin",
  "inicio_semana",
  "fecha_estimada",
  "fecha_cumplido",
  "fecha_pago",
  "registrado_el",
]);

export async function answer(ctx: Context, got: PrivateMessage, wait: number): Promise<void> {
  const topics: Topic[] = got.topics.length ? [...new Set(got.topics)] : ["cronograma"];
  const tabs = [...new Set(topics.flatMap((t) => TABS[t]))];
  const sheet = await readTabs<Tab | "Config">(["Config", ...tabs]);
  const cfg = readConfig(sheet.Config);
  const money = canSeeMoney(ctx, cfg);
  if (!money && (got.money || topics.some((t) => MONEY_TOPICS.includes(t)))) {
    await editMessageText(ctx.chatId, wait, "Eso lo ve solo Carlos.");
    return;
  }
  const text = await answerQuestion(got.transcript, sheetData(topics, sheet, cfg, money));
  const heard = ctx.message?.voice ? `<i>Escuché: «${escapeHtml(got.transcript)}»</i>\n\n` : "";
  await editMessageText(ctx.chatId, wait, `${heard}${escapeHtml(text)}\n\n<i>Dato de la hoja, ${bogotaTime()}</i>`);
}

const dateText = (iso: string) => `${shortDate(iso)} (${iso})`;

/** Una pestaña como texto: encabezados y una fila por línea, con las fechas legibles. */
function table(name: string, rows: Row[], skip: Set<string> = new Set()): string {
  const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((c) => c !== "_row" && !skip.has(c));
  const cell = (c: string, v: unknown) => {
    const iso = DATE_COLUMNS.has(c) ? cellDate(v) : null;
    return (iso ? dateText(iso) : String(v ?? "")).replace(/\s+/g, " ").trim();
  };
  return [`## ${name}`, columns.join(" | "), ...rows.map((r) => columns.map((c) => cell(c, r[c])).join(" | "))].join(
    "\n",
  );
}

/** Los datos que van a Gemini: hechos calculados por el bot y solo las pestañas de los temas. */
function sheetData(topics: Topic[], sheet: Record<string, Row[]>, cfg: Config, money: boolean): string {
  const today = todayISO();
  const week = workWeek(today, cfg);
  const { monday, saturday } = weekRange(today);
  const facts = [
    `Hoy: ${dateText(today)}. ${
      week ? `Semana ${week} de obra (${shortDate(monday)} – ${shortDate(saturday)}).` : "La obra no ha empezado."
    }`,
    `Obra: del ${shortDate(cfg.fecha_inicio)} al ${shortDate(cfg.entrega_sin_zocalos)}${
      cfg.entrega_con_zocalos ? ` (${shortDate(cfg.entrega_con_zocalos)} si se cambian los zócalos)` : ""
    }. Se trabaja de lunes a sábado; festivos: ${cfg.festivos.map(shortDate).join(", ") || "ninguno"}.`,
  ];
  const tables: string[] = [];
  const has = (t: Topic) => topics.includes(t);

  if (has("cronograma")) {
    const tasks = readTasks(sheet.Tareas);
    const thisWeek = tasksForWeek(tasks, today).map((t) => t.id);
    const late = tasks.filter((t) => t.estado !== "terminada" && !t.tentativo && t.fin && t.fin < today);
    facts.push(`Tareas de esta semana sin terminar: ${thisWeek.join(", ") || "ninguna"}.`);
    facts.push(
      `Tareas atrasadas (su fin ya pasó y no están terminadas): ${late.map((t) => t.id).join(", ") || "ninguna"}.`,
    );
    tables.push(table("Tareas", sheet.Tareas));
  }
  if (has("objetivos")) tables.push(table("Objetivos", sheet.Objetivos));
  if (has("esperado")) tables.push(table("Esperado", sheet.Esperado));
  if (has("hitos") || has("pagos")) tables.push(table("Hitos", sheet.Hitos, money ? undefined : MILESTONE_MONEY));
  if (has("pagos")) {
    facts.push(
      `Pagado al albañil: ${formatPesos(masonPaid(sheet.Pagos))} de ${formatPesos(cfg.total_albanil)} ` +
        `(reserva para extras: ${formatPesos(cfg.reserva_albanil)}).`,
    );
    tables.push(table("Pagos", sheet.Pagos));
  }
  if (has("presupuesto")) {
    facts.push(
      `Disponible de los 12 M: ${formatPesos(available12M(cfg, sheet.Gastos, sheet.Pagos))} de ${
        formatPesos(cfg.presupuesto_disponible)
      }.`,
    );
    tables.push(table("Presupuesto", sheet.Presupuesto));
  }
  if (has("compras")) {
    facts.push(`Saldo de la caja menor: ${formatPesos(pettyCashBalance(cfg, sheet.Gastos, sheet.Pagos))}.`);
    tables.push(table("Gastos", sheet.Gastos), table("Productos", sheet.Productos));
  }
  if (has("reportes")) {
    tables.push(table("Reportes", sheet.Reportes.slice(-14), new Set(["texto_reporte"])));
    tables.push(table("Notas", sheet.Notas.slice(-40)));
  }
  return [...facts, "", ...tables].join("\n\n");
}
