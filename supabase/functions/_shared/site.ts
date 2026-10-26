// Reglas de la obra. Todo se calcula con filas leídas de la hoja en ese momento.

import { addDays, cellDate, cellNumber, daysBetween, isYes, normalize, weekday } from "./format.ts";

/** Fila de una pestaña: columna → valor, más el número de fila en la hoja. */
export type Row = Record<string, unknown> & { _row: number };

// Los campos siguen las claves y columnas de la hoja (semillas/).
export interface Config {
  fecha_inicio: string;
  entrega_sin_zocalos: string;
  entrega_con_zocalos: string | null;
  dias_laborales: number[]; // 0 = domingo … 6 = sábado
  festivos: string[];
  presupuesto_disponible: number;
  total_albanil: number;
  reserva_albanil: number;
  fondo_caja_menor: number;
  tope_compra_caja_menor: number;
  compra_sin_factura_max: number;
  compras_sin_factura_por_dia: number;
  hora_objetivos_lunes: string;
  hora_aviso_diario: string;
  hora_cierre_sabado: string;
  hermano_ve_dinero: boolean;
}

export interface Task {
  id: string;
  fase: string;
  tarea: string;
  responsable: string;
  dias: number;
  depende_de: string[];
  inicio: string;
  fin: string;
  hito: string;
  tentativo: boolean;
  estado: string;
  _row: number;
}

const DAY_INDEX: Record<string, number> = { dom: 0, lun: 1, mar: 2, mie: 3, jue: 4, vie: 5, sab: 6 };

function text(v: unknown): string {
  return v === null || v === undefined ? "" : String(v).trim();
}

function list(v: unknown): string[] {
  return text(v).split(/[,;]\s*/).map((x) => x.trim()).filter(Boolean);
}

/** Hora guardada como texto "07:00" o como fracción de día (0,2916…). */
function cellTime(v: unknown, fallback: string): string {
  if (typeof v === "number" && v < 1) {
    const minutes = Math.round(v * 24 * 60);
    return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  }
  const s = text(v);
  return /^\d{1,2}:\d{2}$/.test(s) ? s.padStart(5, "0") : fallback;
}

/** «lun-sáb», «lun,mar,mié» o una mezcla de ambos. */
export function parseWorkDays(value: string): number[] {
  const days = new Set<number>();
  for (const part of value.split(/[,;\s]+/).filter(Boolean)) {
    const [a, b] = part.split(/[-–]/).map((d) => DAY_INDEX[normalize(d).slice(0, 3)]);
    if (a === undefined) continue;
    if (b === undefined) days.add(a);
    else for (let d = a; d !== (b + 1) % 7; d = (d + 1) % 7) days.add(d);
  }
  return [...days].sort();
}

export function readConfig(rows: Row[]): Config {
  const values = new Map<string, unknown>();
  for (const r of rows) values.set(normalize(r.clave), r.valor);
  const date = (k: string) => cellDate(values.get(k));
  const start = date("fecha_inicio");
  const delivery = date("entrega_sin_zocalos");
  if (!start || !delivery) throw new Error("Config: faltan fecha_inicio o entrega_sin_zocalos");
  const workDays = parseWorkDays(text(values.get("dias_laborales")) || "lun-sáb");
  const holidays = text(values.get("festivos"))
    .split(/[,;\s]+/)
    .map((f) => cellDate(f))
    .filter((f): f is string => f !== null);
  return {
    fecha_inicio: start,
    entrega_sin_zocalos: delivery,
    entrega_con_zocalos: date("entrega_con_zocalos"),
    dias_laborales: workDays.length ? workDays : [1, 2, 3, 4, 5, 6],
    festivos: holidays,
    presupuesto_disponible: cellNumber(values.get("presupuesto_disponible")),
    total_albanil: cellNumber(values.get("total_albanil")),
    reserva_albanil: cellNumber(values.get("reserva_albanil")),
    fondo_caja_menor: cellNumber(values.get("fondo_caja_menor")),
    tope_compra_caja_menor: cellNumber(values.get("tope_compra_caja_menor")),
    compra_sin_factura_max: cellNumber(values.get("compra_sin_factura_max")),
    compras_sin_factura_por_dia: values.has("compras_sin_factura_por_dia")
      ? cellNumber(values.get("compras_sin_factura_por_dia"))
      : 1,
    hora_objetivos_lunes: cellTime(values.get("hora_objetivos_lunes"), "07:00"),
    hora_aviso_diario: cellTime(values.get("hora_aviso_diario"), "17:00"),
    hora_cierre_sabado: cellTime(values.get("hora_cierre_sabado"), "17:00"),
    hermano_ve_dinero: isYes(values.get("hermano_ve_dinero")),
  };
}

export function readTasks(rows: Row[]): Task[] {
  return rows
    .filter((r) => text(r.id) !== "")
    .map((r) => ({
      id: text(r.id),
      fase: text(r.fase),
      tarea: text(r.tarea),
      responsable: text(r.responsable),
      dias: cellNumber(r.dias),
      depende_de: list(r.depende_de),
      inicio: cellDate(r.inicio) ?? "",
      fin: cellDate(r.fin) ?? cellDate(r.inicio) ?? "",
      hito: text(r.hito),
      tentativo: isYes(r.tentativo),
      estado: normalize(r.estado) || "pendiente",
      _row: r._row,
    }));
}

// --- Calendario --------------------------------------------------------------

export function isHoliday(iso: string, cfg: Config): boolean {
  return cfg.festivos.includes(iso);
}

export function isWorkDay(iso: string, cfg: Config): boolean {
  return cfg.dias_laborales.includes(weekday(iso)) && !isHoliday(iso, cfg);
}

/** Lunes de la semana (lun–dom) a la que pertenece la fecha. */
export function mondayOf(iso: string): string {
  const d = weekday(iso);
  return addDays(iso, d === 0 ? -6 : 1 - d);
}

/** Semana de obra (1, 2, …) contada desde fecha_inicio; 0 si la obra no ha empezado. */
export function workWeek(iso: string, cfg: Config): number {
  if (iso < cfg.fecha_inicio) return 0;
  return Math.floor(daysBetween(mondayOf(cfg.fecha_inicio), mondayOf(iso)) / 7) + 1;
}

/** Lunes a sábado de la semana de la fecha. */
export function weekRange(iso: string): { monday: string; saturday: string } {
  const monday = mondayOf(iso);
  return { monday, saturday: addDays(monday, 5) };
}

// --- Tareas ------------------------------------------------------------------

function isOpen(t: Task): boolean {
  return t.estado !== "terminada";
}

/** Tareas cuyo rango incluye la fecha y que no están terminadas. */
export function tasksForDay(tasks: Task[], iso: string): Task[] {
  return tasks.filter((t) => isOpen(t) && t.inicio && t.inicio <= iso && iso <= t.fin);
}

/** Tareas cuyas fechas tocan la semana (lun–sáb) de la fecha y que no están terminadas. */
export function tasksForWeek(tasks: Task[], iso: string): Task[] {
  const { monday, saturday } = weekRange(iso);
  return tasks.filter((t) => isOpen(t) && t.inicio && t.inicio <= saturday && t.fin >= monday);
}

/** Días laborales entre dos fechas, ambas incluidas. */
export function workDaysBetween(from: string, to: string, cfg: Config): number {
  let n = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) if (isWorkDay(d, cfg)) n++;
  return n;
}

/**
 * Avance ponderado por los días de cada tarea (sin las tentativas): lo terminado y lo que el cronograma
 * dice que debería ir terminado a la fecha (incluida). Una tarea en curso cuenta por los días laborales
 * que ya pasaron de su rango. Porcentajes de 0 a 100.
 */
export function scheduleProgress(
  tasks: Task[],
  iso: string,
  cfg: Config,
  finishedNow: string[] = [],
): { actual: number; expected: number } {
  const counted = tasks.filter((t) => !t.tentativo && t.dias > 0 && t.inicio);
  const total = counted.reduce((n, t) => n + t.dias, 0);
  if (!total) return { actual: 0, expected: 0 };
  const done = counted
    .filter((t) => t.estado === "terminada" || finishedNow.includes(t.id))
    .reduce((n, t) => n + t.dias, 0);
  const due = counted.reduce((n, t) => {
    if (iso < t.inicio) return n;
    if (iso >= t.fin) return n + t.dias;
    const span = workDaysBetween(t.inicio, t.fin, cfg);
    return n + t.dias * (span ? workDaysBetween(t.inicio, iso, cfg) / span : 1);
  }, 0);
  return { actual: (100 * done) / total, expected: (100 * due) / total };
}

/** Lo que sigue: tareas sin terminar (ni tentativas) cuyas dependencias ya están terminadas, por fecha de inicio. */
export function nextTasks(tasks: Task[], finishedNow: string[] = [], limit = 3): Task[] {
  const done = new Set([...tasks.filter((t) => t.estado === "terminada").map((t) => t.id), ...finishedNow]);
  return tasks
    .filter((t) => !done.has(t.id) && !t.tentativo && t.depende_de.every((d) => done.has(d)))
    .sort((a, b) => a.inicio.localeCompare(b.inicio))
    .slice(0, limit);
}

/**
 * Números de tareas escritos por el usuario: «2-5», «02 - 05», «2, 5 y Z1». Devuelve los ids del cronograma
 * que encontró entre `candidates` (sin repetir, en el orden escrito) y lo que no encontró.
 */
export function parseTaskIds(text: string, candidates: string[]): { ids: string[]; unknown: string[] } {
  const ids: string[] = [];
  const unknown: string[] = [];
  const tokens = text.toUpperCase().replace(/\bY\b/g, "-").split(/[\s,;\-–]+/).filter(Boolean);
  for (const token of tokens) {
    const id = /^\d+$/.test(token)
      ? candidates.find((c) => /^\d+$/.test(c) && Number(c) === Number(token))
      : candidates.find((c) => c.toUpperCase() === token);
    if (!id) unknown.push(token);
    else if (!ids.includes(id)) ids.push(id);
  }
  return { ids, unknown };
}

// --- Dinero ------------------------------------------------------------------

function sum(rows: Row[], column: string, filter: (r: Row) => boolean): number {
  return rows.filter(filter).reduce((acc, r) => acc + cellNumber(r[column]), 0);
}

/** presupuesto_disponible − todo lo de Gastos y Pagos con cuenta_12M = sí. */
export function available12M(cfg: Config, expenses: Row[], payments: Row[]): number {
  const inBudget = (r: Row) => isYes(r.cuenta_12M);
  return cfg.presupuesto_disponible - sum(expenses, "valor", inBudget) - sum(payments, "valor", inBudget);
}

/** fondo + reposiciones (Pagos a Caja menor, cuenta_12M = no) − gastos pagados con caja menor. */
export function pettyCashBalance(cfg: Config, expenses: Row[], payments: Row[]): number {
  const refills = sum(
    payments,
    "valor",
    (r) => normalize(r.a_quien) === "caja menor" && !isYes(r.cuenta_12M),
  );
  const spent = sum(expenses, "valor", (r) => normalize(r.medio_pago) === "caja menor");
  return cfg.fondo_caja_menor + refills - spent;
}

/** Todo lo pagado al albañil (incluye lo entregado antes de la obra). */
export function masonPaid(payments: Row[]): number {
  return sum(payments, "valor", (r) => normalize(r.a_quien) === "albanil");
}

/** total_albanil − todo lo pagado al albañil. */
export function masonBalance(cfg: Config, payments: Row[]): number {
  return cfg.total_albanil - masonPaid(payments);
}

/** Facturas de caja menor que faltan por reponer: fondo − saldo (negativo si se repuso de más). */
export function pettyCashToRefill(cfg: Config, expenses: Row[], payments: Row[]): number {
  return cfg.fondo_caja_menor - pettyCashBalance(cfg, expenses, payments);
}

// --- Pagos e hitos -------------------------------------------------------------

/** A quién se le paga (sección 1 del prompt). Pagos puede traer otros nombres. */
export const PAYEES = [
  "Albañil",
  "Carpintero",
  "Drywall",
  "Aluminio y vidrio",
  "Pulidor",
  "Gases del Caribe",
  "Triple A",
  "Caja menor",
];

/** La lista de PAYEES más los nombres que ya están en Pagos. */
export function payeesOf(payments: Row[]): string[] {
  const names = [...PAYEES];
  for (const r of payments) {
    const name = text(r.a_quien);
    if (name && !names.some((n) => normalize(n) === normalize(name))) names.push(name);
  }
  return names;
}

export const isPettyCash = (payee: unknown) => normalize(payee) === "caja menor";

export interface Milestone {
  hito: string;
  nombre: string;
  fecha_estimada: string;
  criterio: string;
  valor: number;
  valor_a_pagar: number;
  fecha_cumplido: string | null;
  pagado: boolean;
  fecha_pago: string | null;
  _row: number;
}

export function readMilestones(rows: Row[]): Milestone[] {
  return rows
    .filter((r) => text(r.hito) !== "")
    .map((r) => ({
      hito: text(r.hito).toUpperCase(),
      nombre: text(r.nombre),
      fecha_estimada: cellDate(r.fecha_estimada) ?? "",
      criterio: text(r.criterio),
      valor: cellNumber(r.valor),
      valor_a_pagar: cellNumber(r.valor_a_pagar),
      fecha_cumplido: cellDate(r.fecha_cumplido),
      pagado: isYes(r.pagado),
      fecha_pago: cellDate(r.fecha_pago),
      _row: r._row,
    }));
}

/** Capítulos de la pestaña Presupuesto, en su orden. */
export const budgetChapters = (rows: Row[]): string[] => rows.map((r) => text(r.capitulo)).filter(Boolean);
