// Formatos para el usuario: pesos, fechas en America/Bogota y lectura de montos.

export const ZONA = "America/Bogota";

const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** 1234567 -> "$1.234.567" (sin decimales). */
export function pesos(valor: number): string {
  const n = Math.round(valor);
  const signo = n < 0 ? "-" : "";
  const miles = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${signo}$${miles}`;
}

/** Fecha de hoy en Bogotá como "AAAA-MM-DD". */
export function hoyISO(ahora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(ahora);
}

/** Hora en Bogotá como "hh:mm" (24 h). */
export function horaBogota(ahora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: ZONA,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(ahora);
}

/** "2026-10-26" -> "lun 26 oct". */
export function fechaCorta(iso: string): string {
  const d = desdeISO(iso);
  return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()} ${MESES[d.getUTCMonth()]}`;
}

export function desdeISO(iso: string): Date {
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d));
}

export function aISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function sumarDias(iso: string, dias: number): string {
  const d = desdeISO(iso);
  d.setUTCDate(d.getUTCDate() + dias);
  return aISO(d);
}

export function diasEntre(desde: string, hasta: string): number {
  return Math.round((desdeISO(hasta).getTime() - desdeISO(desde).getTime()) / 86_400_000);
}

/** 0 = domingo … 6 = sábado. */
export function diaSemana(iso: string): number {
  return desdeISO(iso).getUTCDay();
}

export function nombreDia(indice: number): string {
  return DIAS[indice];
}

/**
 * Convierte lo que devuelve Sheets (número serial o texto) a "AAAA-MM-DD".
 * Acepta seriales de Sheets, "AAAA-MM-DD" y "DD/MM/AAAA".
 */
export function fechaDeCelda(valor: unknown): string | null {
  if (valor === null || valor === undefined || valor === "") return null;
  if (typeof valor === "number") {
    // Serial de Sheets: días desde 1899-12-30.
    const base = Date.UTC(1899, 11, 30);
    return aISO(new Date(base + Math.floor(valor) * 86_400_000));
  }
  const s = String(valor).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

/** Número desde una celda: acepta números y textos como "1.200.000" o "$700.000". */
export function numeroDeCelda(valor: unknown): number {
  if (typeof valor === "number") return valor;
  if (valor === null || valor === undefined || valor === "") return 0;
  return parsearMonto(String(valor)) ?? 0;
}

/** Minúsculas, sin tildes ni espacios sobrantes. */
export function normalizar(texto: unknown): string {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function esSi(valor: unknown): boolean {
  const v = normalizar(valor);
  return v === "si" || v === "s" || v === "true" || v === "x";
}

export function escaparHtml(texto: string): string {
  return texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ---------------------------------------------------------------------------
// Lectura de montos: «700 mil», «1,2 M», «$1.200.000», «un millón doscientos».

const UNIDADES: Record<string, number> = {
  cero: 0,
  un: 1,
  uno: 1,
  una: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
  trece: 13,
  catorce: 14,
  quince: 15,
  dieciseis: 16,
  diecisiete: 17,
  dieciocho: 18,
  diecinueve: 19,
  veinte: 20,
  veintiun: 21,
  veintiuno: 21,
  veintidos: 22,
  veintitres: 23,
  veinticuatro: 24,
  veinticinco: 25,
  veintiseis: 26,
  veintisiete: 27,
  veintiocho: 28,
  veintinueve: 29,
  treinta: 30,
  cuarenta: 40,
  cincuenta: 50,
  sesenta: 60,
  setenta: 70,
  ochenta: 80,
  noventa: 90,
  cien: 100,
  ciento: 100,
  doscientos: 200,
  doscientas: 200,
  trescientos: 300,
  trescientas: 300,
  cuatrocientos: 400,
  cuatrocientas: 400,
  quinientos: 500,
  quinientas: 500,
  seiscientos: 600,
  seiscientas: 600,
  setecientos: 700,
  setecientas: 700,
  ochocientos: 800,
  ochocientas: 800,
  novecientos: 900,
  novecientas: 900,
};

/** Devuelve el monto en pesos o null si no encuentra uno. */
export function parsearMonto(texto: string): number | null {
  const t = normalizar(texto).replace(/\$/g, " ").replace(/\bcop\b|\bpesos?\b/g, " ");
  return montoNumerico(t) ?? montoEnPalabras(t);
}

function montoNumerico(t: string): number | null {
  // Número (que no sea parte de «H1» o «F01») + sufijo opcional: mil, k, m, millón, palo.
  const re =
    /(?<![a-z0-9])(\d{1,3}(?:['.,]\d{3})+|\d+(?:[.,]\d{1,2})?)(?!\d)\s*(millones|millon|mill|palos?|m(?![a-z])|mil(?![a-z])|k(?![a-z]))?(?:\s+(?:y\s+)?(medio))?/;
  const m = t.match(re);
  if (!m) return null;
  const [, numero, sufijo, medio] = m;
  const multiplicador = sufijo ? /^(millones|millon|mill|palos?|m)$/.test(sufijo) ? 1_000_000 : 1_000 : 1;
  // Grupos de 3 cifras (1.200.000 · 1'200.000 · 1,200,000) son separadores de miles.
  // Lo demás es decimal: 1,2 · 1.5 · 700.
  const valor = /^\d{1,3}(?:['.,]\d{3})+$/.test(numero)
    ? Number(numero.replace(/['.,]/g, ""))
    : Number(numero.replace(",", "."));
  if (!Number.isFinite(valor)) return null;
  let total = valor * multiplicador;
  if (medio && multiplicador > 1) total += multiplicador / 2;
  return Math.round(total);
}

function montoEnPalabras(t: string): number | null {
  const palabras = t.split(/[\s-]+/).filter((p) => p && p !== "y" && p !== "de");
  let total = 0;
  let grupo = 0;
  let encontrado = false;
  let despuesDeMillon = false;
  let huboMilDespues = false;
  for (const p of palabras) {
    if (p in UNIDADES) {
      grupo += UNIDADES[p];
      encontrado = true;
    } else if (p === "mil") {
      total += (grupo || 1) * 1_000;
      grupo = 0;
      encontrado = true;
      if (despuesDeMillon) huboMilDespues = true;
    } else if (p === "millon" || p === "millones" || p === "palo" || p === "palos") {
      total = (total + (grupo || 1)) * 1_000_000;
      grupo = 0;
      encontrado = true;
      despuesDeMillon = true;
    } else if (p === "medio" && despuesDeMillon) {
      total += 500_000;
    } else if (encontrado) {
      // «una caja de tornillos por quince mil»: el «una» suelto no es el monto.
      if (total > 0) break;
      grupo = 0;
      encontrado = false;
    }
  }
  if (!encontrado) return null;
  // «un millón doscientos» = 1.200.000: lo que sigue al millón son miles.
  if (despuesDeMillon && !huboMilDespues && grupo > 0 && grupo < 1000) {
    total += grupo * 1_000;
  } else {
    total += grupo;
  }
  return total;
}
