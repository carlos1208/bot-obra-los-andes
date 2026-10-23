// Reglas de la obra. Todo se calcula con filas leídas de la hoja en ese momento.

import { diaSemana, diasEntre, esSi, fechaDeCelda, normalizar, numeroDeCelda, sumarDias } from "./formato.ts";

export type Fila = Record<string, unknown> & { _fila: number };

// Los nombres siguen las columnas y claves de la hoja (semillas/).
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

export interface Tarea {
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
  _fila: number;
}

const DIAS: Record<string, number> = { dom: 0, lun: 1, mar: 2, mie: 3, jue: 4, vie: 5, sab: 6 };

function texto(v: unknown): string {
  return v === null || v === undefined ? "" : String(v).trim();
}

function lista(v: unknown): string[] {
  return texto(v).split(/[,;]\s*/).map((x) => x.trim()).filter(Boolean);
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

/** «lun-sáb», «lun,mar,mié» o una mezcla de ambos. */
export function leerDiasLaborales(valor: string): number[] {
  const dias = new Set<number>();
  for (const parte of valor.split(/[,;\s]+/).filter(Boolean)) {
    const [a, b] = parte.split(/[-–]/).map((d) => DIAS[normalizar(d).slice(0, 3)]);
    if (a === undefined) continue;
    if (b === undefined) dias.add(a);
    else for (let d = a; d !== (b + 1) % 7; d = (d + 1) % 7) dias.add(d);
  }
  return [...dias].sort();
}

export function leerConfig(filas: Fila[]): Config {
  const p = new Map<string, unknown>();
  for (const f of filas) p.set(normalizar(f.clave ?? f.parametro), f.valor);
  const fecha = (k: string) => fechaDeCelda(p.get(k));
  const inicio = fecha("fecha_inicio");
  const entrega = fecha("entrega_sin_zocalos");
  if (!inicio || !entrega) throw new Error("Config: faltan fecha_inicio o entrega_sin_zocalos");
  const dias = leerDiasLaborales(texto(p.get("dias_laborales")) || "lun-sáb");
  const festivos = texto(p.get("festivos"))
    .split(/[,;\s]+/)
    .map((f) => fechaDeCelda(f))
    .filter((f): f is string => f !== null);
  return {
    fecha_inicio: inicio,
    entrega_sin_zocalos: entrega,
    entrega_con_zocalos: fecha("entrega_con_zocalos"),
    dias_laborales: dias.length ? dias : [1, 2, 3, 4, 5, 6],
    festivos,
    presupuesto_disponible: numeroDeCelda(p.get("presupuesto_disponible")),
    total_albanil: numeroDeCelda(p.get("total_albanil")),
    reserva_albanil: numeroDeCelda(p.get("reserva_albanil")),
    fondo_caja_menor: numeroDeCelda(p.get("fondo_caja_menor")),
    tope_compra_caja_menor: numeroDeCelda(p.get("tope_compra_caja_menor")),
    compra_sin_factura_max: numeroDeCelda(p.get("compra_sin_factura_max")),
    hora_objetivos_lunes: horaDeCelda(p.get("hora_objetivos_lunes"), "07:00"),
    hora_aviso_diario: horaDeCelda(p.get("hora_aviso_diario"), "17:00"),
    hora_cierre_sabado: horaDeCelda(p.get("hora_cierre_sabado"), "17:00"),
    hermano_ve_dinero: esSi(p.get("hermano_ve_dinero")),
  };
}

export function leerTareas(filas: Fila[]): Tarea[] {
  return filas
    .filter((f) => texto(f.id) !== "")
    .map((f) => ({
      id: texto(f.id),
      fase: texto(f.fase),
      tarea: texto(f.tarea),
      responsable: texto(f.responsable),
      dias: numeroDeCelda(f.dias),
      depende_de: lista(f.depende_de),
      inicio: fechaDeCelda(f.inicio) ?? "",
      fin: fechaDeCelda(f.fin) ?? fechaDeCelda(f.inicio) ?? "",
      hito: texto(f.hito),
      tentativo: esSi(f.tentativo),
      estado: normalizar(f.estado) || "pendiente",
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
  return cfg.presupuesto_disponible - suma(gastos, "valor", enDoce) - suma(pagos, "valor", enDoce);
}

/** fondo + reposiciones (Pagos a Caja menor, cuenta_12M = no) − gastos pagados con caja menor. */
export function saldoCajaMenor(cfg: Config, gastos: Fila[], pagos: Fila[]): number {
  const reposiciones = suma(
    pagos,
    "valor",
    (f) => normalizar(f.a_quien) === "caja menor" && !esSi(f.cuenta_12M),
  );
  const gastado = suma(gastos, "valor", (f) => normalizar(f.medio_pago) === "caja menor");
  return cfg.fondo_caja_menor + reposiciones - gastado;
}

/** total_albanil − todo lo pagado al albañil (incluye lo entregado antes de la obra). */
export function saldoAlbanil(cfg: Config, pagos: Fila[]): number {
  return cfg.total_albanil - suma(pagos, "valor", (f) => normalizar(f.a_quien) === "albanil");
}
