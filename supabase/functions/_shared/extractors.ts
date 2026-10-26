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

const READ_NOTE_INSTRUCTIONS =
  `Lees una nota de la obra (texto o nota de voz, en español de Colombia) para el reporte del día.
- transcript: lo que dice, palabra por palabra. Si hay una aclaración, solo lo que dice la aclaración.
- summary: lo que se entiende, en frases cortas y claras: qué se hizo, qué pasó, qué falta o qué se necesita. Conserva cantidades, materiales, lugares y nombres. Si hay una nota original y una aclaración, el resumen es el de la nota ya aclarada.
No inventes ni agregues nada que la nota no diga. No la relaciones con tareas de un cronograma.`;

/** Lee una nota del reporte (o su aclaración) para preguntar «¿Quisiste decir esto?». */
export function readNote(input: InlineFile | string, original: string | null, model?: string): Promise<NoteSummary> {
  const audio = typeof input !== "string";
  const label = original ? "Aclaración" : "Nota";
  const parts: Part[] = [
    ...(original ? [`Nota original: ${original}`] : []),
    audio ? `${label} en esta nota de voz:` : `${label}: ${input}`,
    ...(audio ? [input] : []),
  ];
  return generateJson<NoteSummary>({ instructions: READ_NOTE_INSTRUCTIONS, parts, schema: NOTE_SCHEMA, model });
}

export interface DaySummary {
  summary: string;
  warnings: string[];
}

const DAY_SUMMARY_INSTRUCTIONS =
  `Escribes el resumen del día de una obra con las notas que mandó quien reporta (ya confirmadas), en orden de hora.
- summary: texto corto, en viñetas que empiezan con «• », de lo que se hizo y lo que pasó en el día. Junta lo repetido. Si una nota posterior corrige a una anterior, vale la más reciente. No inventes. Español de Colombia.
- warnings: solo contradicciones claras que no se explican. Una frase corta por cada una; si no hay, lista vacía.`;

/** Resumen del día con todas las notas confirmadas de hoy. */
export function summarizeDay(notes: { hora: string; texto: string }[], model?: string): Promise<DaySummary> {
  return generateJson<DaySummary>({
    instructions: DAY_SUMMARY_INSTRUCTIONS,
    parts: ["Notas de hoy:", ...notes.map((n, i) => `${i + 1}. [${n.hora}] ${n.texto}`)],
    schema: {
      type: "object",
      properties: { summary: { type: "string" }, warnings: { type: "array", items: { type: "string" } } },
      required: ["summary", "warnings"],
    },
    model,
  });
}
