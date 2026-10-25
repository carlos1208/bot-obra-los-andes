// Formatos para el usuario: pesos, fechas en America/Bogota y lectura de montos.

export const TIME_ZONE = "America/Bogota";

/** Reloj del bot. Las pruebas lo cambian para simular la fecha. */
export const clock = { now: (): Date => new Date() };

const DAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** 1234567 -> "$1.234.567" (sin decimales). */
export function formatPesos(value: number): string {
  const n = Math.round(value);
  const sign = n < 0 ? "-" : "";
  const thousands = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}$${thousands}`;
}

/** Fecha de hoy en Bogotá como "AAAA-MM-DD". */
export function todayISO(now: Date = clock.now()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Hora en Bogotá como "hh:mm" (24 h). */
export function bogotaTime(now: Date = clock.now()): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
}

/** "2026-10-26" -> "lun 26 oct". */
export function shortDate(iso: string): string {
  const d = fromISO(iso);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export function fromISO(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const d = fromISO(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toISO(d);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((fromISO(to).getTime() - fromISO(from).getTime()) / 86_400_000);
}

/** 0 = domingo … 6 = sábado. */
export function weekday(iso: string): number {
  return fromISO(iso).getUTCDay();
}

/**
 * Convierte lo que devuelve Sheets (número serial o texto) a "AAAA-MM-DD".
 * Acepta seriales de Sheets, "AAAA-MM-DD" y "DD/MM/AAAA".
 */
export function cellDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") {
    // Serial de Sheets: días desde 1899-12-30.
    const base = Date.UTC(1899, 11, 30);
    return toISO(new Date(base + Math.floor(value) * 86_400_000));
  }
  const s = String(value).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

/** Fecha escrita por el usuario: «hoy», «ayer», «24/10», «24/10/2026» o «2026-10-24». */
export function parseDateInput(text: string, today: string): string | null {
  const t = normalize(text);
  if (t === "hoy") return today;
  if (t === "ayer") return addDays(today, -1);
  if (t === "anteayer" || t === "antier") return addDays(today, -2);
  const short = t.match(/^(\d{1,2})[/-](\d{1,2})$/);
  const iso = short
    ? `${today.slice(0, 4)}-${short[2].padStart(2, "0")}-${short[1].padStart(2, "0")}`
    : cellDate(t.replace(/^(\d{1,2})-(\d{1,2})-(\d{4})$/, "$1/$2/$3"));
  // Descarta fechas que no existen (31/02).
  return iso && toISO(fromISO(iso)) === iso ? iso : null;
}

/** Número desde una celda: acepta números y textos como "1.200.000" o "$700.000". */
export function cellNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (value === null || value === undefined || value === "") return 0;
  return parseAmount(String(value)) ?? 0;
}

/** Minúsculas, sin tildes ni espacios sobrantes. */
export function normalize(text: unknown): string {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** «sí», «si», «Sí», «x» … */
export function isYes(value: unknown): boolean {
  const v = normalize(value);
  return v === "si" || v === "s" || v === "true" || v === "x";
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ---------------------------------------------------------------------------
// Lectura de montos: «700 mil», «1,2 M», «$1.200.000», «un millón doscientos».

const NUMBER_WORDS: Record<string, number> = {
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
export function parseAmount(text: string): number | null {
  const t = normalize(text).replace(/\$/g, " ").replace(/\bcop\b|\bpesos?\b/g, " ");
  return numericAmount(t) ?? amountInWords(t);
}

function numericAmount(t: string): number | null {
  // Número (que no sea parte de «H1» o «F01») + sufijo opcional: mil, k, m, millón, palo.
  const re =
    /(?<![a-z0-9])(\d{1,3}(?:['.,]\d{3})+|\d+(?:[.,]\d{1,2})?)(?!\d)\s*(millones|millon|mill|palos?|m(?![a-z])|mil(?![a-z])|k(?![a-z]))?(?:\s+(?:y\s+)?(medio))?/;
  const m = t.match(re);
  if (!m) return null;
  const [, digits, suffix, half] = m;
  const multiplier = suffix ? /^(millones|millon|mill|palos?|m)$/.test(suffix) ? 1_000_000 : 1_000 : 1;
  // Grupos de 3 cifras (1.200.000 · 1'200.000 · 1,200,000) son separadores de miles.
  // Lo demás es decimal: 1,2 · 1.5 · 700.
  const value = /^\d{1,3}(?:['.,]\d{3})+$/.test(digits)
    ? Number(digits.replace(/['.,]/g, ""))
    : Number(digits.replace(",", "."));
  if (!Number.isFinite(value)) return null;
  let total = value * multiplier;
  if (half && multiplier > 1) total += multiplier / 2;
  return Math.round(total);
}

function amountInWords(t: string): number | null {
  const words = t.split(/[\s-]+/).filter((w) => w && w !== "y" && w !== "de");
  let total = 0;
  let group = 0;
  let found = false;
  let afterMillion = false;
  let thousandAfterMillion = false;
  for (const w of words) {
    if (w in NUMBER_WORDS) {
      group += NUMBER_WORDS[w];
      found = true;
    } else if (w === "mil") {
      total += (group || 1) * 1_000;
      group = 0;
      found = true;
      if (afterMillion) thousandAfterMillion = true;
    } else if (w === "millon" || w === "millones" || w === "palo" || w === "palos") {
      total = (total + (group || 1)) * 1_000_000;
      group = 0;
      found = true;
      afterMillion = true;
    } else if (w === "medio" && afterMillion) {
      total += 500_000;
    } else if (found) {
      // «una caja de tornillos por quince mil»: el «una» suelto no es el monto.
      if (total > 0) break;
      group = 0;
      found = false;
    }
  }
  if (!found) return null;
  // «un millón doscientos» = 1.200.000: lo que sigue al millón son miles.
  if (afterMillion && !thousandAfterMillion && group > 0 && group < 1000) {
    total += group * 1_000;
  } else {
    total += group;
  }
  return total;
}
