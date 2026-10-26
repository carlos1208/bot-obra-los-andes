// Extracciones con Gemini: cada una con sus instrucciones y su esquema JSON.
// Las usan los agentes del bot y el script de validación de la fase 2.

import { generateJson, type InlineFile, type Part } from "./gemini.ts";

export interface Invoice {
  supplier: string;
  tax_id: string | null;
  date: string | null; // AAAA-MM-DD
  number: string | null;
  items: string[];
  total: number | null; // pesos enteros
  chapter: string;
}

const INVOICE_INSTRUCTIONS =
  `Extraes los datos de una factura de compra colombiana (foto o PDF) para registrar un gasto de obra.
- Lee solo lo que está impreso. Si un dato no se ve, devuelve null; no lo inventes.
- number: número de la factura de venta tal como aparece junto a «N°», «No.» o «Factura», con el prefijo pegado y sin espacios (p. ej. «FE 1234» → «FE1234»). No uses el CUFE, la orden de compra, el número interno ni la resolución de la DIAN.
- date: fecha de expedición o de emisión, en AAAA-MM-DD. En Colombia las fechas van día/mes/año: «03/11/2026» es 2026-11-03. No uses la de vencimiento ni la de validación DIAN.
- total: el total a pagar, con IVA y redondeo, en pesos enteros. No es el efectivo recibido, el cambio ni el ahorro. Los pesos no llevan centavos: un punto o una coma seguidos de tres dígitos separan miles, y «,00» o «.00» al final son centavos en cero. «2.450.900,00», «$45.300» y «87,650» son 2450900, 45300 y 87650.
- supplier: nombre comercial corto de la tienda, el que usa la gente; si no aparece, la razón social.
- tax_id: NIT del vendedor como aparece (p. ej. 800.242.106-2). No el documento del cliente.
- items: lo comprado, en frases cortas y claras en español (p. ej. «Lavamanos ovalado blanco»), sin códigos ni precios.
- chapter: el capítulo del presupuesto que mejor encaja con lo comprado.`;

function invoiceSchema(chapters: string[]): Record<string, unknown> {
  const nullable = (type: string, description: string, extra: Record<string, unknown> = {}) => ({
    type: [type, "null"],
    description,
    ...extra,
  });
  return {
    type: "object",
    properties: {
      supplier: { type: "string", description: "Nombre comercial de la tienda" },
      tax_id: nullable("string", "NIT del vendedor"),
      date: nullable("string", "Fecha de expedición", { format: "date" }),
      number: nullable("string", "Número de la factura con prefijo"),
      items: { type: "array", items: { type: "string" }, description: "Lo comprado, en frases cortas" },
      total: nullable("integer", "Total a pagar en pesos enteros"),
      chapter: oneOf(chapters, "Capítulo del presupuesto"),
    },
    required: ["supplier", "tax_id", "date", "number", "items", "total", "chapter"],
  };
}

/** Lee una factura (foto o PDF). `chapters` sale de la pestaña Presupuesto en ese momento. */
export function extractInvoice(file: InlineFile, chapters: string[], model?: string): Promise<Invoice> {
  return generateJson<Invoice>({
    instructions: INVOICE_INSTRUCTIONS,
    parts: ["Extrae los datos de esta factura.", file],
    schema: invoiceSchema(chapters),
    model,
  });
}

export interface NoteSummary {
  transcript: string;
  summary: string;
}

const NOTE_INSTRUCTIONS =
  `Recibes una nota de voz o un texto sobre una obra (remodelación de un apartamento en Barranquilla), en español de Colombia.
- transcript: lo que dice, palabra por palabra. Si es texto, cópialo igual.
- summary: una o dos frases cortas con lo importante: qué pasó, qué falta, montos y fechas si los hay. Sin saludos ni relleno.`;

const NOTE_SCHEMA = {
  type: "object",
  properties: {
    transcript: { type: "string", description: "Transcripción literal" },
    summary: { type: "string", description: "Resumen en una o dos frases" },
  },
  required: ["transcript", "summary"],
};

/** Transcribe y resume una nota de voz (OGG de Telegram, audio/ogg) o un texto libre. */
export function summarizeNote(note: InlineFile | string, model?: string): Promise<NoteSummary> {
  return generateJson<NoteSummary>({
    instructions: NOTE_INSTRUCTIONS,
    parts: typeof note === "string" ? [note] : ["Transcribe y resume esta nota de voz.", note],
    schema: NOTE_SCHEMA,
    model,
  });
}

/** Lista cerrada para el esquema; si está vacía, texto libre (Gemini no acepta un enum vacío). */
function oneOf(values: string[], description: string): Record<string, unknown> {
  return values.length ? { type: "string", enum: values, description } : { type: "string", description };
}

export interface NoInvoicePurchase {
  supplier: string | null;
  items: string;
  chapter: string;
}

const NO_INVOICE_INSTRUCTIONS =
  `Registras una compra pequeña sin factura de una obra en Colombia. Recibes la foto del producto y la nota de quien compró.
- items: qué se compró, en una frase corta y clara.
- supplier: dónde se compró, solo si la nota lo dice; si no, null.
- chapter: el capítulo del presupuesto que mejor encaja con lo comprado.`;

/** Compra sin factura: foto del producto + nota. El valor lo lee el bot de la nota, no Gemini. */
export function extractNoInvoicePurchase(
  photo: InlineFile,
  note: string,
  chapters: string[],
  model?: string,
): Promise<NoInvoicePurchase> {
  return generateJson<NoInvoicePurchase>({
    instructions: NO_INVOICE_INSTRUCTIONS,
    parts: [`Nota: ${note}`, photo],
    schema: {
      type: "object",
      properties: {
        supplier: { type: ["string", "null"], description: "Dónde se compró" },
        items: { type: "string", description: "Qué se compró" },
        chapter: oneOf(chapters, "Capítulo del presupuesto"),
      },
      required: ["supplier", "items", "chapter"],
    },
    model,
  });
}

/** Opciones del reporte diario que Gemini puede elegir (salen de la hoja y del flujo con botones). */
export interface ReportOptions {
  /** Tareas del cronograma que no están terminadas; `when` son sus fechas. */
  tasks: { id: string; label: string; when?: string }[];
  expected: string[];
  water: string[];
  news: string[];
  tomorrow: { id: string; label: string }[];
}

/** Lo que dice una nota (o el día) en la estructura del reporte. */
export interface ReportFields {
  tasks: { id: string; status: "terminada" | "avanzó" }[];
  extra_work: string | null;
  expected: { item: string; arrived: boolean }[];
  water: string | null;
  water_detail: string | null;
  news: string[];
  news_detail: string | null;
  tomorrow: string[];
  tomorrow_detail: string | null;
}

export interface NoteReading extends ReportFields {
  transcript: string;
}

export interface DayReport extends ReportFields {
  warnings: string[];
}

/** Nota del día como está en la pestaña Notas. */
export interface DayNote {
  hora: string;
  quien: string;
  texto: string;
}

const FIELD_RULES =
  `- tasks: solo tareas de la lista que sean claramente el trabajo que se describe. status «terminada» si se terminó o quedó lista; «avanzó» si se trabajó sin terminar. Si no es claro, no la pongas.
- extra_work: el trabajo hecho que no es claramente una tarea de la lista, en frases cortas; null si no hay. No fuerces una tarea de la lista.
- expected: de lo esperado hoy, lo que llegó (arrived true) o no llegó (arrived false).
- water: solo si se habla del agua o de Triple A: la opción que mejor encaja. water_detail: el detalle (por ejemplo la fecha) o null.
- news: solo novedades que se mencionen. «Sin novedad» solo si lo dicen. Si no se habla de novedades, lista vacía. news_detail: resumen corto o null.
- tomorrow: lo que se necesita mañana, de la lista. tomorrow_detail: lo que pidan y no esté en la lista, o null.`;

function contextText(options: ReportOptions): string {
  return [
    "Tareas del cronograma que no están terminadas:",
    ...options.tasks.map((t) => `- ${t.id}: ${t.label}${t.when ? ` (${t.when})` : ""}`),
    "Esperado hoy:",
    ...(options.expected.length ? options.expected.map((e) => `- ${e}`) : ["- (nada)"]),
    "Lo que se puede necesitar mañana:",
    ...options.tomorrow.map((t) => `- ${t.id}: ${t.label}`),
  ].join("\n");
}

function fieldsSchema(options: ReportOptions): Record<string, unknown> {
  return {
    tasks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: oneOf(options.tasks.map((t) => t.id), "Número de la tarea"),
          status: { type: "string", enum: ["terminada", "avanzó"] },
        },
        required: ["id", "status"],
      },
    },
    extra_work: { type: ["string", "null"], description: "Trabajo hecho que no es una tarea de la lista" },
    expected: {
      type: "array",
      items: {
        type: "object",
        properties: { item: oneOf(options.expected, "Lo esperado"), arrived: { type: "boolean" } },
        required: ["item", "arrived"],
      },
    },
    water: { anyOf: [oneOf(options.water, "Novedad del agua"), { type: "null" }] },
    water_detail: { type: ["string", "null"] },
    news: { type: "array", items: oneOf(options.news, "Novedad") },
    news_detail: { type: ["string", "null"] },
    tomorrow: { type: "array", items: oneOf(options.tomorrow.map((t) => t.id), "Lo que se necesita mañana") },
    tomorrow_detail: { type: ["string", "null"] },
  };
}

const FIELDS = [
  "tasks",
  "extra_work",
  "expected",
  "water",
  "water_detail",
  "news",
  "news_detail",
  "tomorrow",
  "tomorrow_detail",
];

const READ_NOTE_INSTRUCTIONS =
  `Lees una nota de la obra (texto o nota de voz, en español de Colombia) para el reporte diario.
- transcript: lo que dice la nota, palabra por palabra. Si hay una aclaración, solo lo que dice la aclaración.
- Si hay una nota original y una aclaración, la aclaración corrige o completa la original: los campos quedan como resultan después de aclarar.
Usa solo lo que dice. No inventes.
${FIELD_RULES}`;

/** Lee una nota (o su aclaración) para preguntar «¿Quisiste decir esto?». */
export function readNote(
  input: InlineFile | string,
  original: string | null,
  options: ReportOptions,
  model?: string,
): Promise<NoteReading> {
  const audio = typeof input !== "string";
  const label = original ? "Aclaración" : "Nota";
  const parts: Part[] = [
    contextText(options),
    ...(original ? [`Nota original: ${original}`] : []),
    audio ? `${label} en esta nota de voz:` : `${label}: ${input}`,
    ...(audio ? [input] : []),
  ];
  return generateJson<NoteReading>({
    instructions: READ_NOTE_INSTRUCTIONS,
    parts,
    schema: {
      type: "object",
      properties: { transcript: { type: "string" }, ...fieldsSchema(options) },
      required: ["transcript", ...FIELDS],
    },
    model,
  });
}

const DAY_REPORT_INSTRUCTIONS =
  `Combinas en un solo reporte diario las notas del día de una obra, ya confirmadas por quien reporta, en orden de hora. Si hay un reporte anterior, es la base y las notas lo actualizan.
Usa solo lo que dicen. No inventes.
- Las notas se suman: avanzar por partes en el mismo trabajo no es contradicción.
- Si una nota posterior corrige a una anterior, vale la más reciente.
- warnings: solo contradicciones claras que no se explican (una nota dice que algo pasó y otra que no, sin decir que corrige). Una frase corta por cada una; si no hay, lista vacía.
${FIELD_RULES}`;

/** Arma el reporte del día con las notas confirmadas (y el reporte anterior, si hay). */
export function extractDayReport(
  notes: DayNote[],
  previous: string[],
  options: ReportOptions,
  model?: string,
): Promise<DayReport> {
  const parts = [
    contextText(options),
    ...previous.map((p) => `Reporte anterior:\n${p}`),
    "Notas de hoy:",
    ...notes.map((n, i) => `${i + 1}. [${n.hora}, ${n.quien}] ${n.texto}`),
  ];
  return generateJson<DayReport>({
    instructions: DAY_REPORT_INSTRUCTIONS,
    parts,
    schema: {
      type: "object",
      properties: { ...fieldsSchema(options), warnings: { type: "array", items: { type: "string" } } },
      required: [...FIELDS, "warnings"],
    },
    model,
  });
}
