// Reglas de la obra. Todo se calcula con filas leídas de la hoja en ese momento.

import { diaSemana, diasEntre, esSi, fechaDeCelda, normalizar, numeroDeCelda, sumarDias } from "./formato.ts";

export type Fila = Record<string, unknown> & { _fila: number };

export interface Config {
  fecha_inicio: string;
  fecha_fin: string;
  fecha_fin_con_zocalos: string | null;
  dias_laborales: number[]; // 0 = domingo … 6 = sábado
  festivos: string[];
  presupuesto_disponible: number;
  total_albanil: number;
  reserva_albanil: number;
  fondo_caja_menor: number;
  tope_compra_caja_menor: number;
  compra_sin_factura_max: number;
  hora_aviso_lunes: string;
  hora_aviso_diario: string;
  hermano_ve_dinero: boolean;
}

export interface Tarea {
  id: string;
  descripcion: string;
  oficio: string;
  inicio: string;
  fin: string;
  hito: string;
  materiales: string;
  estado: string;
  tentativo: boolean;
  _fila: number;
}

const DIAS: Record<string, number> = { dom: 0, lun: 1, mar: 2, mie: 3, jue: 4, vie: 5, sab: 6 };

function texto(v: unknown): string {
  return v === null || v === undefined ? "" : String(v).trim();
}

/** Hora guardada como texto "07:00" o como fracción de día (0,2916…). */
function horaDeCelda(v: unknown, porDefecto: string): string {
  if (typeof v === "number" && v < 1) {
    const minutos = Math.round(v * 24 * 60);
    return `${String(Math.floor(minutos / 60)).padStart(2, "0")}:${String(minutos % 60).padStart(2, "0")}`;
  }
  const s = texto(v);
  return /^\d{1,2}:\d{2}$/.test(s) ? s.padStart(5, "0") : porDefecto;
}

export function leerConfig(filas: Fila[]): Config {
  const p = new Map<string, unknown>();
  for (const f of filas) p.set(normalizar(f.parametro), f.valor);
  const fecha = (k: string) => fechaDeCelda(p.get(k));
  const inicio = fecha("fecha_inicio");
  const fin = fecha("fecha_fin");
  if (!inicio || !fin) throw new Error("Config: faltan fecha_inicio o fecha_fin");
  const dias = texto(p.get("dias_laborales") ?? "lun,mar,mie,jue,vie,sab")
    .split(/[,\s]+/)
    .map((d) => DIAS[normalizar(d).slice(0, 3)])
    .filter((d) => d !== undefined);
  const festivos = texto(p.get("festivos"))
    .split(/[,;\s]+/)
    .map((f) => fechaDeCelda(f))
    .filter((f): f is string => f !== null);
  return {
    fecha_inicio: inicio,
    fecha_fin: fin,
    fecha_fin_con_zocalos: fecha("fecha_fin_con_zocalos"),
    dias_laborales: dias.length ? dias : [1, 2, 3, 4, 5, 6],
    festivos,
    presupuesto_disponible: numeroDeCelda(p.get("presupuesto_disponible")),
    total_albanil: numeroDeCelda(p.get("total_albanil")),
    reserva_albanil: numeroDeCelda(p.get("reserva_albanil")),
    fondo_caja_menor: numeroDeCelda(p.get("fondo_caja_menor")),
    tope_compra_caja_menor: numeroDeCelda(p.get("tope_compra_caja_menor")),
    compra_sin_factura_max: numeroDeCelda(p.get("compra_sin_factura_max")),
    hora_aviso_lunes: horaDeCelda(p.get("hora_aviso_lunes"), "07:00"),
    hora_aviso_diario: horaDeCelda(p.get("hora_aviso_diario"), "17:00"),
    hermano_ve_dinero: esSi(p.get("hermano_ve_dinero")),
  };
}

export function leerTareas(filas: Fila[]): Tarea[] {
  return filas
    .filter((f) => texto(f.id) !== "")
    .map((f) => ({
      id: texto(f.id),
      descripcion: texto(f.descripcion),
      oficio: texto(f.oficio),
      inicio: fechaDeCelda(f.inicio) ?? "",
      fin: fechaDeCelda(f.fin) ?? fechaDeCelda(f.inicio) ?? "",
      hito: texto(f.hito),
      materiales: texto(f.materiales),
      estado: normalizar(f.estado) || "pendiente",
      tentativo: esSi(f.tentativo),
      _fila: f._fila,
    }));
}

// --- Calendario --------------------------------------------------------------

export function esFestivo(iso: string, cfg: Config): boolean {
  return cfg.festivos.includes(iso);
}

export function esDiaDeObra(iso: string, cfg: Config): boolean {
  return cfg.dias_laborales.includes(diaSemana(iso)) && !esFestivo(iso, cfg);
}

/** Lunes de la semana (lun–dom) a la que pertenece la fecha. */
export function lunesDe(iso: string): string {
  const d = diaSemana(iso);
  return sumarDias(iso, d === 0 ? -6 : 1 - d);
}

/** Semana de obra (1, 2, …) contada desde fecha_inicio; 0 si la obra no ha empezado. */
export function semanaDeObra(iso: string, cfg: Config): number {
  if (iso < cfg.fecha_inicio) return 0;
  return Math.floor(diasEntre(lunesDe(cfg.fecha_inicio), lunesDe(iso)) / 7) + 1;
}

/** Lunes a sábado de la semana de la fecha. */
export function rangoSemana(iso: string): { lunes: string; sabado: string } {
  const lunes = lunesDe(iso);
  return { lunes, sabado: sumarDias(lunes, 5) };
}

// --- Tareas ------------------------------------------------------------------

function abierta(t: Tarea): boolean {
  return t.estado !== "terminada";
}

/** Tareas cuyo rango incluye la fecha y que no están terminadas. */
export function tareasDelDia(tareas: Tarea[], iso: string): Tarea[] {
  return tareas.filter((t) => abierta(t) && t.inicio && t.inicio <= iso && iso <= t.fin);
}

/** Tareas cuyas fechas tocan la semana (lun–sáb) de la fecha y que no están terminadas. */
export function tareasDeLaSemana(tareas: Tarea[], iso: string): Tarea[] {
  const { lunes, sabado } = rangoSemana(iso);
  return tareas.filter((t) => abierta(t) && t.inicio && t.inicio <= sabado && t.fin >= lunes);
}

// --- Dinero ------------------------------------------------------------------

function suma(filas: Fila[], columna: string, filtro: (f: Fila) => boolean): number {
  return filas.filter(filtro).reduce((acc, f) => acc + numeroDeCelda(f[columna]), 0);
}

/** presupuesto_disponible − todo lo de Gastos y Pagos con cuenta_12M = sí. */
export function disponible12M(cfg: Config, gastos: Fila[], pagos: Fila[]): number {
  const enDoce = (f: Fila) => esSi(f.cuenta_12M);
  return cfg.presupuesto_disponible - suma(gastos, "total", enDoce) - suma(pagos, "valor", enDoce);
}

/** fondo + reposiciones (Pagos a Caja menor, cuenta_12M = no) − gastos pagados con caja menor. */
export function saldoCajaMenor(cfg: Config, gastos: Fila[], pagos: Fila[]): number {
  const reposiciones = suma(
    pagos,
    "valor",
    (f) => normalizar(f.a_quien) === "caja menor" && !esSi(f.cuenta_12M),
  );
  const gastado = suma(gastos, "total", (f) => normalizar(f.medio_pago) === "caja menor");
  return cfg.fondo_caja_menor + reposiciones - gastado;
}

/** total_albanil − todo lo pagado al albañil (incluye lo entregado antes de la obra). */
export function saldoAlbanil(cfg: Config, pagos: Fila[]): number {
  return cfg.total_albanil - suma(pagos, "valor", (f) => normalizar(f.a_quien) === "albanil");
}
