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

/** total_albanil − todo lo pagado al albañil (incluye lo entregado antes de la obra). */
export function masonBalance(cfg: Config, payments: Row[]): number {
  return cfg.total_albanil - sum(payments, "valor", (r) => normalize(r.a_quien) === "albanil");
}
