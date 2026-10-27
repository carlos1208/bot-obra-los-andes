// Datos del tablero. Todo se lee de la hoja (y los pares de Drive) en el momento de abrirlo; nada se guarda.
// Dinero (los 12 M, presupuesto por capítulo, pagos y albañil, valores de los hitos): solo si quien mira puede
// verlo, con la misma regla del bot (Carlos, o el hermano si hermano_ve_dinero = sí). Compras y caja menor las
// ven los dos, como en las preguntas del bot.

import { CATALOG } from "../_shared/catalog.ts";
import { addDays, bogotaTime, cellDate, cellNumber, isYes, normalize, todayISO } from "../_shared/format.ts";
import { listPairs, STATE } from "../_shared/pairs.ts";
import { readTabs } from "../_shared/sheets.ts";
import {
  available12M,
  type Config,
  isHoliday,
  isPettyCash,
  isWorkDay,
  masonPaid,
  mondayOf,
  obraEnd,
  overdueTasks,
  pettyCashBalance,
  pettyCashToRefill,
  readConfig,
  readMilestones,
  readTasks,
  type Row,
  scheduleProgress,
  type Task,
  unconfirmedExpected,
  workDaysBetween,
  workWeek,
} from "../_shared/site.ts";

export type Viewer = "carlos" | "hermano";
export type TaskState = "terminada" | "en curso" | "atrasada" | "pendiente";

export interface DayPoint {
  date: string;
  expected: number;
  /** Avance real: el del reporte de ese día y, hoy, el de la hoja en este momento. */
  actual?: number;
}

export interface WeekTask {
  id: string;
  name: string;
  who: string;
  state: TaskState;
  tentative: boolean;
  /** Lunes a sábado: si la tarea cae ese día. */
  days: boolean[];
}

export interface WorkWeekView {
  number: number;
  monday: string;
  /** Lunes a sábado. */
  days: string[];
  /** Festivos o días que no se trabaja. */
  off: boolean[];
  tasks: WeekTask[];
  current: boolean;
}

export interface LateTask {
  id: string;
  name: string;
  end: string;
  days: number;
}

export interface LateExpected {
  date: string;
  what: string;
  task: string;
  /** Días de obra desde la fecha (0 si es hoy). */
  days: number;
  notArrived: boolean;
}

export interface MilestoneView {
  hito: string;
  name: string;
  estimated: string;
  done: string | null;
  criteria: string;
  late: boolean;
  /** Solo con dinero. */
  toPay?: number;
  paid?: boolean;
}

export interface ChapterView {
  name: string;
  budget: number;
  spent: number;
  state: string;
}

export interface PaymentView {
  date: string | null;
  payee: string;
  concept: string;
  amount: number;
  method: string;
  in12M: boolean;
}

export interface MoneyView {
  budget: number;
  available: number;
  /** Lo pagado antes, fuera de los 12 M (sin las reposiciones de caja menor). */
  outside12M: number;
  chapters: ChapterView[];
  /** Lo de los 12 M con un capítulo que no está en Presupuesto. */
  otherSpent: number;
  mason: { total: number; paid: number; balance: number; reserve: number };
  payments: PaymentView[];
}

export interface ExpenseView {
  date: string | null;
  supplier: string;
  items: string;
  chapter: string;
  amount: number;
  payment: string;
  /** Enlace a la factura en Drive (solo Carlos). */
  link?: string;
}

export interface ProductView {
  date: string | null;
  supplier: string;
  invoice: string;
  name: string;
  printed: string;
  quantity: number;
  unit: string;
  total: number;
  chapter: string;
}

export interface Purchases {
  total: number;
  beforeStart: number;
  byWeek: { week: number; monday: string; total: number }[];
  byChapter: { name: string; total: number }[];
  latest: ExpenseView[];
  count: number;
  products: ProductView[];
  pettyCash: { fund: number; balance: number; toRefill: number };
}

export interface PairView {
  code: string;
  name: string;
  state: string;
  uploadedBy: string;
  before?: string;
  after?: string;
}

export interface ReportView {
  date: string;
  time: string;
  by: string;
  summary: string;
  finished: string;
  actual: number | null;
  expected: number | null;
  arrived: string;
  notArrived: string;
  next: string;
  text: string;
}

export interface Dashboard {
  viewer: Viewer;
  money: boolean;
  today: string;
  time: string;
  start: string;
  end: string;
  deliveryWithoutBaseboards: string;
  deliveryWithBaseboards: string | null;
  week: number;
  /** Días de obra que faltan hasta la entrega sin zócalos, sin contar hoy. */
  workDaysLeft: number;
  todayNote: string;
  progress: { actual: number; expected: number; curve: DayPoint[] };
  weeks: WorkWeekView[];
  lateTasks: LateTask[];
  lateExpected: LateExpected[];
  milestones: MilestoneView[];
  moneyView?: MoneyView;
  purchases: Purchases;
  pairs: PairView[];
  /** Fotos del catálogo que todavía no tienen ANTES. */
  missingBefore: { code: string; name: string }[];
  pairsError?: string;
  reports: ReportView[];
}

const TABS = [
  "Config",
  "Tareas",
  "Esperado",
  "Hitos",
  "Gastos",
  "Pagos",
  "Presupuesto",
  "Productos",
  "Reportes",
] as const;

/** Reportes que se muestran (los más recientes). */
const REPORTS_SHOWN = 7;
/** Gastos en la lista de los últimos. */
const EXPENSES_SHOWN = 15;

const text = (v: unknown) => String(v ?? "").trim();
const round1 = (n: number) => Math.round(n * 10) / 10;
const byDateDesc = <T extends { date: string | null }>(a: T, b: T) => (b.date ?? "").localeCompare(a.date ?? "");
const link = (v: unknown) => /^https:\/\//.test(text(v)) ? text(v) : undefined;

/**
 * Lee la hoja y Drive y arma el tablero de quien lo abre. `photoUrl` firma el enlace de cada foto
 * (el tablero no muestra enlaces de Drive: las fotos pasan por la función).
 */
export async function buildDashboard(
  viewer: Viewer,
  photoUrl: (fileId: string) => Promise<string>,
  today = todayISO(),
): Promise<Dashboard> {
  const [sheet, pairs] = await Promise.all([
    readTabs([...TABS]),
    listPairs().then((p) => ({ ok: p }), (e: unknown) => ({ error: e })),
  ]);
  const cfg = readConfig(sheet.Config);
  const tasks = readTasks(sheet.Tareas);
  const money = viewer === "carlos" || cfg.hermano_ve_dinero;
  const end = obraEnd(cfg);
  const late = overdueTasks(tasks, today, cfg);
  const lateIds = new Set(late.map((x) => x.task.id));
  const now = scheduleProgress(tasks, today, cfg);

  const dashboard: Dashboard = {
    viewer,
    money,
    today,
    time: bogotaTime(),
    start: cfg.fecha_inicio,
    end,
    deliveryWithoutBaseboards: cfg.entrega_sin_zocalos,
    deliveryWithBaseboards: cfg.entrega_con_zocalos,
    week: workWeek(today, cfg),
    workDaysLeft: workDaysBetween(
      [addDays(today, 1), cfg.fecha_inicio].sort().at(-1)!,
      cfg.entrega_sin_zocalos,
      cfg,
    ),
    todayNote: today < cfg.fecha_inicio || today > end
      ? ""
      : isHoliday(today, cfg)
      ? "Hoy es festivo: no se trabaja."
      : isWorkDay(today, cfg)
      ? ""
      : "Hoy no se trabaja.",
    progress: { actual: round1(now.actual), expected: round1(now.expected), curve: curve(tasks, cfg, sheet, today) },
    weeks: weeks(tasks, cfg, today, lateIds),
    lateTasks: late.map(({ task, days }) => ({ id: task.id, name: task.tarea, end: task.fin, days })),
    lateExpected: unconfirmedExpected(sheet.Esperado, today).map((r) => {
      const date = cellDate(r.fecha)!;
      return {
        date,
        what: text(r.quien_o_que),
        task: text(r.tarea_id),
        days: workDaysBetween(addDays(date, 1), today, cfg),
        notArrived: normalize(r.llego) === "no",
      };
    }),
    milestones: readMilestones(sheet.Hitos).map((m) => ({
      hito: m.hito,
      name: m.nombre,
      estimated: m.fecha_estimada,
      done: m.fecha_cumplido,
      criteria: m.criterio,
      late: !m.fecha_cumplido && m.fecha_estimada !== "" && m.fecha_estimada < today,
      ...(money ? { toPay: m.valor_a_pagar, paid: m.pagado } : {}),
    })),
    moneyView: money ? moneyView(cfg, sheet) : undefined,
    purchases: purchases(cfg, sheet, viewer, today),
    pairs: [],
    missingBefore: [],
    reports: reports(sheet.Reportes),
  };

  if ("ok" in pairs) {
    dashboard.pairs = await Promise.all(pairs.ok.map(async (p) => ({
      code: p.code,
      name: p.name,
      state: p.state,
      uploadedBy: p.uploadedBy,
      before: p.before[0] ? await photoUrl(p.before[0].id) : undefined,
      after: p.after.at(-1) ? await photoUrl(p.after.at(-1)!.id) : undefined,
    })));
    const codes = new Set(pairs.ok.map((p) => p.code));
    dashboard.missingBefore = CATALOG.filter((c) => !codes.has(c.codigo)).map((c) => ({
      code: c.codigo,
      name: c.nombre,
    }));
  } else {
    console.error("tablero: pares de Drive", pairs.error);
    dashboard.pairsError = "No pude leer las fotos de Drive. Vuelve a abrir el tablero en un rato.";
  }
  return dashboard;
}

/** Avance esperado de cada día de obra y el real de los reportes (el último de cada día); hoy, el de la hoja. */
function curve(tasks: Task[], cfg: Config, sheet: Record<string, Row[]>, today: string): DayPoint[] {
  const reported = new Map<string, number>();
  for (const r of sheet.Reportes) {
    const date = cellDate(r.fecha);
    if (date && text(r.avance_obra_pct) !== "") reported.set(date, cellNumber(r.avance_obra_pct));
  }
  const points: DayPoint[] = [];
  for (let d = cfg.fecha_inicio; d <= obraEnd(cfg); d = addDays(d, 1)) {
    const p = scheduleProgress(tasks, d, cfg);
    const point: DayPoint = { date: d, expected: round1(p.expected) };
    if (d === today) point.actual = round1(p.actual);
    else if (d < today && reported.has(d)) point.actual = reported.get(d);
    points.push(point);
  }
  return points;
}

function stateOf(t: Task, late: Set<string>): TaskState {
  if (t.estado === "terminada") return "terminada";
  if (late.has(t.id)) return "atrasada";
  return t.estado === "en curso" ? "en curso" : "pendiente";
}

/** Semanas de obra (lunes a sábado) con las tareas que caen en cada una. */
function weeks(tasks: Task[], cfg: Config, today: string, late: Set<string>): WorkWeekView[] {
  const scheduled = tasks.filter((t) => t.inicio);
  const last = [obraEnd(cfg), ...scheduled.map((t) => t.fin)].sort().at(-1)!;
  const thisMonday = mondayOf(today < cfg.fecha_inicio ? cfg.fecha_inicio : today > last ? last : today);
  const out: WorkWeekView[] = [];
  for (let monday = mondayOf(cfg.fecha_inicio); monday <= last; monday = addDays(monday, 7)) {
    const days = [0, 1, 2, 3, 4, 5].map((i) => addDays(monday, i));
    const saturday = days[5];
    out.push({
      number: workWeek(saturday, cfg),
      monday,
      days,
      off: days.map((d) => !isWorkDay(d, cfg)),
      tasks: scheduled
        .filter((t) => t.inicio <= saturday && t.fin >= monday)
        .sort((a, b) => a.inicio.localeCompare(b.inicio) || a.id.localeCompare(b.id, "es", { numeric: true }))
        .map((t) => ({
          id: t.id,
          name: t.tarea,
          who: t.responsable,
          state: stateOf(t, late),
          tentative: t.tentativo,
          days: days.map((d) => t.inicio <= d && d <= t.fin),
        })),
      current: monday === thisMonday,
    });
  }
  return out;
}

function moneyView(cfg: Config, sheet: Record<string, Row[]>): MoneyView {
  const all = [...sheet.Gastos, ...sheet.Pagos];
  const in12M = all.filter((r) => isYes(r.cuenta_12M));
  const outside = normalize("Pagado antes de los 12 M");
  const chapters: ChapterView[] = sheet.Presupuesto
    .filter((r) => text(r.capitulo) && normalize(r.capitulo) !== outside)
    .map((r) => ({
      name: text(r.capitulo),
      budget: cellNumber(r.presupuestado),
      spent: in12M.filter((x) => normalize(x.capitulo) === normalize(r.capitulo))
        .reduce((s, x) => s + cellNumber(x.valor), 0),
      state: text(r.estado),
    }));
  const known = new Set(chapters.map((c) => normalize(c.name)));
  const paid = masonPaid(sheet.Pagos);
  return {
    budget: cfg.presupuesto_disponible,
    available: available12M(cfg, sheet.Gastos, sheet.Pagos),
    outside12M: all.filter((r) => !isYes(r.cuenta_12M) && !isPettyCash(r.a_quien))
      .reduce((s, r) => s + cellNumber(r.valor), 0),
    chapters,
    otherSpent: in12M.filter((r) => !known.has(normalize(r.capitulo))).reduce((s, r) => s + cellNumber(r.valor), 0),
    mason: { total: cfg.total_albanil, paid, balance: cfg.total_albanil - paid, reserve: cfg.reserva_albanil },
    payments: sheet.Pagos.filter((r) => text(r.a_quien) || cellNumber(r.valor)).map((r) => ({
      date: cellDate(r.fecha),
      payee: text(r.a_quien),
      concept: text(r.concepto),
      amount: cellNumber(r.valor),
      method: text(r.medio),
      in12M: isYes(r.cuenta_12M),
    })).sort(byDateDesc),
  };
}

function purchases(cfg: Config, sheet: Record<string, Row[]>, viewer: Viewer, today: string): Purchases {
  const expenses: ExpenseView[] = sheet.Gastos.filter((r) => text(r.proveedor) || cellNumber(r.valor)).map((r) => ({
    date: cellDate(r.fecha),
    supplier: text(r.proveedor),
    items: text(r.items),
    chapter: text(r.capitulo),
    amount: cellNumber(r.valor),
    payment: text(r.medio_pago),
    ...(viewer === "carlos" && link(r.enlace_factura) ? { link: link(r.enlace_factura) } : {}),
  }));
  const byWeek = new Map<number, number>();
  const byChapter = new Map<string, number>();
  let beforeStart = 0;
  for (const e of expenses) {
    if (e.date && e.date < cfg.fecha_inicio) beforeStart += e.amount;
    else if (e.date) byWeek.set(workWeek(e.date, cfg), (byWeek.get(workWeek(e.date, cfg)) ?? 0) + e.amount);
    const chapter = e.chapter || "Sin capítulo";
    byChapter.set(chapter, (byChapter.get(chapter) ?? 0) + e.amount);
  }
  const lastWeek = Math.max(workWeek(today, cfg), ...byWeek.keys(), 0);
  const firstMonday = mondayOf(cfg.fecha_inicio);
  return {
    total: expenses.reduce((s, e) => s + e.amount, 0),
    beforeStart,
    byWeek: Array.from({ length: lastWeek }, (_, i) => ({
      week: i + 1,
      monday: addDays(firstMonday, 7 * i),
      total: byWeek.get(i + 1) ?? 0,
    })),
    byChapter: [...byChapter].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total),
    latest: [...expenses].sort(byDateDesc).slice(0, EXPENSES_SHOWN),
    count: expenses.length,
    products: sheet.Productos.filter((r) => text(r.producto)).map((r) => ({
      date: cellDate(r.fecha),
      supplier: text(r.proveedor),
      invoice: text(r.numero_factura),
      name: text(r.producto),
      printed: text(r.descripcion_factura),
      quantity: cellNumber(r.cantidad),
      unit: text(r.unidad),
      total: cellNumber(r.valor_total),
      chapter: text(r.capitulo),
    })).sort(byDateDesc),
    pettyCash: {
      fund: cfg.fondo_caja_menor,
      balance: pettyCashBalance(cfg, sheet.Gastos, sheet.Pagos),
      toRefill: pettyCashToRefill(cfg, sheet.Gastos, sheet.Pagos),
    },
  };
}

function reports(rows: Row[]): ReportView[] {
  const pct = (v: unknown) => text(v) === "" ? null : cellNumber(v);
  return rows
    .filter((r) => cellDate(r.fecha))
    .map((r) => ({
      date: cellDate(r.fecha)!,
      time: text(r.hora),
      by: text(r.reportado_por),
      summary: text(r.resumen_del_dia),
      finished: text(r.tareas_terminadas),
      actual: pct(r.avance_obra_pct),
      expected: pct(r.avance_esperado_pct),
      arrived: text(r.llego_esperado),
      notArrived: text(r.no_llego),
      next: text(r.para_continuar),
      text: text(r.texto_reporte),
    }))
    .sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time))
    .slice(0, REPORTS_SHOWN);
}

/** Estados de un par, en el orden en que se muestran. */
export const PAIR_STATES = [
  STATE.pendingApproval,
  STATE.noAfter,
  STATE.toValidate,
  STATE.checkOnSite,
  STATE.validated,
] as const;
