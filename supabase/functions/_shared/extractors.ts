// Extracciones con Gemini: cada una con sus instrucciones y su esquema JSON.
// Las usan los agentes del bot y el script de validación de la fase 2.

import { generateJson, type InlineFile, type Part } from "./gemini.ts";

/** Una línea de la factura: producto o servicio. */
export interface InvoiceLine {
  name: string;
  /** Descripción tal como viene en la factura, para auditar el nombre que puso la IA. */
  printed?: string;
  quantity: number;
  unit: string;
  total: number | null; // lo pagado por la línea, en pesos enteros
}

export interface Invoice {
  supplier: string;
  tax_id: string | null;
  date: string | null; // AAAA-MM-DD
  number: string | null;
  products: InvoiceLine[];
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
- products: cada línea de la factura, en el orden impreso, también fletes, transporte, cortes y otros servicios. No son líneas los subtotales, el IVA, los descuentos generales ni las formas de pago.
  - name: nombre corto y claro en español, con la medida o la presentación si la trae (p. ej. «Pintura blanca de 1 galón»). Sin código de barras ni SKU. Si una abreviatura no se entiende, déjala como está impresa.
  - printed: la descripción tal como está impresa en la factura, sin el código de barras ni el SKU.
  - quantity: la cantidad de la línea («3.0000» es 3).
  - unit: «und» si la factura dice NIU, UND, UN o no dice nada; «m2» para MTK o M2; «m» para MTR; «kg» para KGM; si no, la unidad impresa en minúscula.
  - total: lo que se pagó por la línea, en pesos enteros: con IVA y ya restado el descuento o ahorro de esa línea. Suele ser el último valor de la línea (valor total o subtotal con impuesto), no el precio unitario de lista. Si no se ve, null.
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
      products: {
        type: "array",
        description: "Líneas de la factura",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Producto o servicio" },
            printed: { type: "string", description: "Descripción tal como está impresa" },
            quantity: { type: "number", description: "Cantidad" },
            unit: { type: "string", description: "Unidad: und, m2, m, kg…" },
            total: nullable("integer", "Pagado por la línea, con IVA y descuento, en pesos enteros"),
          },
          required: ["name", "printed", "quantity", "unit", "total"],
        },
      },
      total: nullable("integer", "Total a pagar en pesos enteros"),
      chapter: oneOf(chapters, "Capítulo del presupuesto"),
    },
    required: ["supplier", "tax_id", "date", "number", "products", "total", "chapter"],
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

const PROPOSE_TASKS_INSTRUCTIONS =
  `Propones las tareas del cronograma de una obra que se verán en una foto ANTES con este nombre (y el motivo, si lo hay).
- tasks: solo las tareas que claramente correspondan a lo que muestra la foto; máximo 5. Si ninguna corresponde, lista vacía.`;

/** Tareas del cronograma para una foto ANTES con nombre libre («Otro nombre» o imprevisto). */
export async function proposeTasks(
  name: string,
  reason: string | null,
  tasks: { id: string; label: string }[],
  model?: string,
): Promise<string[]> {
  const got = await generateJson<{ tasks: string[] }>({
    instructions: PROPOSE_TASKS_INSTRUCTIONS,
    parts: [
      ["Tareas del cronograma:", ...tasks.map((t) => `- ${t.id}: ${t.label}`)].join("\n"),
      `Foto: ${name}${reason ? `\nMotivo: ${reason}` : ""}`,
    ],
    schema: {
      type: "object",
      properties: { tasks: { type: "array", items: oneOf(tasks.map((t) => t.id), "Número de la tarea"), maxItems: 5 } },
      required: ["tasks"],
    },
    model,
  });
  const valid = new Set(tasks.map((t) => t.id));
  return [...new Set(got.tasks.filter((id) => valid.has(id)))];
}

// --- Privado: pagos, reposiciones y preguntas -----------------------------------

/** Datos de la hoja que puede necesitar una pregunta. */
export const TOPICS = {
  cronograma: "tareas, fechas, semanas, qué toca, atrasos y quién hace qué",
  objetivos: "objetivos semanales de cada persona",
  esperado: "visitas y entregas esperadas: qué debe llegar y si llegó",
  hitos: "hitos del albañil: fechas, criterios y si están cumplidos",
  pagos: "pagos hechos (a quién y cuánto) y lo pagado al albañil",
  presupuesto: "presupuesto por capítulo, lo gastado y lo disponible de los 12 M",
  compras: "compras, facturas, productos y caja menor",
  reportes: "reportes diarios y notas de la obra",
} as const;
export type Topic = keyof typeof TOPICS;

export interface PrivateMessage {
  transcript: string;
  kind: "pago" | "reposicion" | "pregunta" | "otro";
  payee: string | null;
  concept: string | null;
  amount: number | null;
  method: string | null;
  date: string | null; // AAAA-MM-DD
  chapter: string;
  topics: Topic[];
  money: boolean;
}

const PRIVATE_INSTRUCTIONS = (who: string, today: string) =>
  `Lees un mensaje (texto o nota de voz, en español de Colombia) que ${who} le manda al bot de una obra. Hoy es ${today}.
- transcript: lo que dice, palabra por palabra. Si es texto, cópialo igual.
- kind: «pago» si cuenta un pago que ya hizo; «reposicion» si repuso o recargó la caja menor; «pregunta» si pregunta algo de la obra; «otro» si no es nada de eso.
Si es pago o reposición:
- payee: a quién se le pagó, con uno de los nombres de la lista si corresponde. En una reposición, «Caja menor».
- concept: concepto corto, con lo que dice el mensaje (si menciona un hito, va en el concepto). En una reposición: «Reposición de caja menor».
- amount: valor en pesos enteros: «700 mil» = 700000, «1,2 M» = 1200000, «un millón doscientos» = 1200000. Si no lo dice, null.
- method: medio de pago como lo dice (Nequi, efectivo, transferencia…); si no lo dice, null.
- date: fecha del pago en AAAA-MM-DD. Sin fecha o «hoy» = hoy; «ayer» = el día anterior.
- chapter: el capítulo del presupuesto que mejor encaja con el pago.
Si es pregunta:
- topics: qué datos de la hoja hacen falta para responderla.
- money: true si pregunta por pagos, valores de hitos, presupuesto, lo gastado o lo disponible. Las compras y la caja menor no cuentan como dinero.
Lo que no aplique: null, «ninguno», lista vacía o false.`;

/** Mensaje libre por privado: ¿pago, reposición de caja menor o pregunta? Con los datos de cada caso. */
export function interpretMessage(
  input: InlineFile | string,
  opts: {
    fromCarlos: boolean;
    today: string; // «mié 28 oct de 2026 (2026-10-28)»
    payees: string[];
    chapters: string[];
  },
  model?: string,
): Promise<PrivateMessage> {
  const who = opts.fromCarlos ? "Carlos, el dueño," : "el maestro de obra";
  const audio = typeof input !== "string";
  return generateJson<PrivateMessage>({
    instructions: PRIVATE_INSTRUCTIONS(who, opts.today),
    parts: [
      `A quién se paga: ${opts.payees.join(", ")}.`,
      audio ? "Mensaje en esta nota de voz:" : `Mensaje: ${input}`,
      ...(audio ? [input] : []),
    ],
    schema: {
      type: "object",
      properties: {
        transcript: { type: "string" },
        kind: { type: "string", enum: ["pago", "reposicion", "pregunta", "otro"] },
        payee: { type: ["string", "null"], description: "A quién se le pagó" },
        concept: { type: ["string", "null"], description: "Concepto corto" },
        amount: { type: ["integer", "null"], description: "Valor en pesos enteros" },
        method: { type: ["string", "null"], description: "Medio de pago" },
        date: { type: ["string", "null"], format: "date", description: "Fecha del pago" },
        chapter: oneOf(opts.chapters, "Capítulo del presupuesto"),
        topics: {
          type: "array",
          items: {
            type: "string",
            enum: Object.keys(TOPICS),
            description: Object.entries(TOPICS).map(([k, v]) => `${k}: ${v}`).join("; "),
          },
        },
        money: { type: "boolean" },
      },
      required: [
        "transcript",
        "kind",
        "payee",
        "concept",
        "amount",
        "method",
        "date",
        "chapter",
        "topics",
        "money",
      ],
    },
    model,
  });
}

const ANSWER_INSTRUCTIONS =
  `Respondes una pregunta sobre una obra (remodelación de un apartamento en Barranquilla) con los datos de la hoja que te paso, leídos en este momento.
- answer: la respuesta en español de Colombia, en frases cortas y concretas. Usa solo estos datos; si no alcanzan, dilo. No inventes.
- Pesos con punto de miles y sin decimales ($1.234.567). Fechas como «lun 26 oct».
- Si es una lista, una línea por elemento que empieza con «• ».
- Sin saludos ni relleno.`;

/** Redacta la respuesta a una pregunta con los datos de la hoja (solo los que la pregunta necesita). */
export async function answerQuestion(question: string, data: string, model?: string): Promise<string> {
  const got = await generateJson<{ answer: string }>({
    instructions: ANSWER_INSTRUCTIONS,
    parts: [`Datos de la hoja:\n${data}`, `Pregunta: ${question}`],
    schema: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] },
    model,
  });
  return got.answer;
}

// --- Facturas del correo (XML de la DIAN) ---------------------------------------

export interface InvoiceNaming {
  supplier: string;
  names: string[];
  chapter: string;
}

const NAMING_INSTRUCTIONS =
  `Recibes los datos de una factura electrónica de compra de una obra en Colombia, ya leídos de su XML. No calcules nada: solo nombra.
- supplier: el nombre comercial corto de la tienda, el que usa la gente (p. ej. por la tienda o el correo del vendedor), no la razón social.
- names: por cada descripción, en el mismo orden y la misma cantidad, un nombre corto y claro en español con la medida o la presentación si la trae. Si una abreviatura no se entiende, déjala como está.
- chapter: el capítulo del presupuesto que mejor encaja con lo comprado.`;

/** Una llamada corta de texto: nombre comercial, nombres legibles de los productos y capítulo. */
export async function nameInvoiceLines(
  seller: { legalName: string; tradeName: string; storeName: string | null; email: string },
  printed: string[],
  chapters: string[],
  model?: string,
): Promise<InvoiceNaming> {
  const got = await generateJson<InvoiceNaming>({
    instructions: NAMING_INSTRUCTIONS,
    parts: [
      [
        `Razón social: ${seller.legalName}`,
        seller.tradeName && seller.tradeName !== seller.legalName ? `Nombre en la factura: ${seller.tradeName}` : "",
        seller.storeName ? `Tienda: ${seller.storeName}` : "",
        seller.email ? `Correo del vendedor: ${seller.email}` : "",
      ].filter(Boolean).join("\n"),
      ["Descripciones:", ...printed.map((p, i) => `${i + 1}. ${p}`)].join("\n"),
    ],
    schema: {
      type: "object",
      properties: {
        supplier: { type: "string", description: "Nombre comercial de la tienda" },
        names: { type: "array", items: { type: "string" }, minItems: printed.length, maxItems: printed.length },
        chapter: oneOf(chapters, "Capítulo del presupuesto"),
      },
      required: ["supplier", "names", "chapter"],
    },
    model,
  });
  // Si no devolvió un nombre por descripción, quedan las descripciones tal como vienen.
  const names = got.names.length === printed.length ? got.names : printed;
  return { ...got, names: names.map((n, i) => n.trim() || printed[i]) };
}
