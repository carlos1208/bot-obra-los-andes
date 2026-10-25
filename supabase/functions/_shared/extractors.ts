// Extracciones con Gemini: cada una con sus instrucciones y su esquema JSON.
// Las usan los agentes del bot y el script de validación de la fase 2.

import { generateJson, type InlineFile } from "./gemini.ts";

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
      chapter: chapters.length
        ? { type: "string", enum: chapters, description: "Capítulo del presupuesto" }
        : { type: "string", description: "Capítulo del presupuesto" },
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
