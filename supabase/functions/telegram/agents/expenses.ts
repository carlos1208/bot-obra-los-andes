// Gastos y facturas: foto o PDF → Gemini → vista previa → «Caja menor» o «Pagó Carlos» →
// «Sí, guardar» o «Corregir campo». Nada se escribe en la hoja hasta «Sí, guardar».
// La factura se sube a Drive «Facturas/» y el enlace queda en la fila de Gastos.

import { claimStep, deleteSession, readSession, saveSession, type Session } from "../../_shared/db.ts";
import { FOLDERS, topFolder, uploadFile } from "../../_shared/drive.ts";
import { envNumber } from "../../_shared/env.ts";
import { extractInvoice, extractNoInvoicePurchase } from "../../_shared/extractors.ts";
import {
  cellDate,
  escapeHtml,
  formatPesos,
  normalize,
  parseAmount,
  parseDateInput,
  shortDate,
  todayISO,
} from "../../_shared/format.ts";
import { appendRow, readTabs } from "../../_shared/sheets.ts";
import { type Config, pettyCashBalance, readConfig, type Row } from "../../_shared/site.ts";
import {
  answerCallback,
  downloadFile,
  editKeyboard,
  editMessageText,
  imageOf,
  invoiceFileOf,
  type Keyboard,
  MAX_FILE_BYTES,
  type ReceivedImage,
  sendMessage,
} from "../../_shared/telegram.ts";
import type { Context } from "../context.ts";
import { button, type FlowBase, isActiveButton, roleLabel, short } from "../ui.ts";
import * as report from "./report.ts";

/** Valor de sesiones.flujo para este flujo. */
export const FLOW = "gasto";

type Payment = "caja menor" | "Carlos";
type Field = "supplier" | "tax_id" | "date" | "number" | "items" | "total" | "chapter" | "payment";

const FIELD_NAMES: Record<Field, string> = {
  supplier: "Proveedor",
  tax_id: "NIT",
  date: "Fecha",
  number: "Número",
  items: "Ítems",
  total: "Total",
  chapter: "Capítulo",
  payment: "Pago",
};

const ASK_FIELD: Partial<Record<Field, string>> = {
  date: "Escribe la fecha (por ejemplo 24/10 o ayer).",
  total: "Escribe el total (por ejemplo 45.300 o 45 mil).",
};

interface Draft {
  noInvoice: boolean;
  file: ReceivedImage;
  supplier: string;
  tax_id: string;
  date: string; // "" = falta
  number: string;
  items: string;
  total: number | null;
  chapter: string;
  payment: Payment | "";
  note: string;
}

/** Sesión del reporte que abrió «Agregar compra»: se restaura al terminar el gasto. */
export interface ReturnTo {
  flujo: string;
  paso: string;
  datos: Record<string, unknown>;
}

interface Data extends FlowBase {
  draft?: Draft;
  field?: Field;
  pending?: ReceivedImage;
  back?: ReturnTo;
}

async function save(ctx: Context, step: string, data: Data): Promise<void> {
  await saveSession(ctx.chatId, ctx.userId, FLOW, step, { ...data, hilo: ctx.threadId ?? null });
}

async function readChapters(): Promise<string[]> {
  const { Presupuesto } = await readTabs(["Presupuesto"]);
  return Presupuesto.map((r) => String(r.capitulo ?? "").trim()).filter(Boolean);
}

function countNoInvoiceToday(expenses: Row[], today: string): number {
  return expenses.filter((r) => cellDate(r.fecha) === today && normalize(r.nota).startsWith("sin factura")).length;
}

// --- Inicio ------------------------------------------------------------------

/** /gasto o «Agregar compra» desde el reporte. */
export async function start(ctx: Context, back?: ReturnTo): Promise<void> {
  const m = await ctx.reply(
    "Manda la foto o el PDF de la factura. Si no hay factura, toca «Sin factura».",
    [[button("Sin factura", "gas:sf"), button("Cancelar", "gas:x")]],
  );
  await save(ctx, "foto", { back, msg: m.message_id });
}

/** Llega la foto o el PDF de una factura. */
export async function receiveInvoice(ctx: Context, file: ReceivedImage, back?: ReturnTo): Promise<void> {
  if (file.size && file.size > MAX_FILE_BYTES) {
    await ctx.reply("El archivo pesa más de 20 MB. Mándalo como foto.");
    return;
  }
  const wait = await ctx.reply("Leyendo la factura…");
  const chapters = await readChapters();
  const { bytes } = await downloadFile(file.fileId);
  const inv = await extractInvoice({ mimeType: file.mime, bytes }, chapters);
  const draft: Draft = {
    noInvoice: false,
    file,
    supplier: inv.supplier ?? "",
    tax_id: inv.tax_id ?? "",
    date: inv.date ?? "",
    number: inv.number ?? "",
    items: inv.items.join(", "),
    total: inv.total,
    chapter: inv.chapter ?? "",
    payment: "",
    note: "",
  };
  await showPreview(ctx, { back, draft }, wait.message_id);
}

async function startNoInvoice(ctx: Context, data: Data, messageId: number): Promise<void> {
  const { Config, Gastos } = await readTabs(["Config", "Gastos"]);
  const cfg = readConfig(Config);
  const count = countNoInvoiceToday(Gastos, todayISO());
  if (count >= cfg.compras_sin_factura_por_dia) {
    await editMessageText(
      ctx.chatId,
      messageId,
      `Hoy ya hay ${count} compra${
        count > 1 ? "s" : ""
      } sin factura. El máximo es ${cfg.compras_sin_factura_por_dia} por día. Pide la factura.`,
    );
    await finish(ctx, data.back);
    return;
  }
  await editMessageText(
    ctx.chatId,
    messageId,
    `Manda la foto del producto con una nota: qué es, dónde y cuánto costó. Sin factura, máximo ${
      formatPesos(cfg.compra_sin_factura_max)
    }.`,
    [[button("Cancelar", "gas:x")]],
  );
  await save(ctx, "producto", { ...data, msg: messageId });
}

async function receiveProduct(ctx: Context, data: Data, photo: ReceivedImage, note: string): Promise<void> {
  const cfg = readConfig((await readTabs(["Config"])).Config);
  const total = parseAmount(note);
  if (total !== null && total > cfg.compra_sin_factura_max) {
    await ctx.reply(
      `Sin factura solo se aceptan compras de hasta ${formatPesos(cfg.compra_sin_factura_max)}. Pide la factura.`,
    );
    await finish(ctx, data.back);
    return;
  }
  const wait = await ctx.reply("Revisando la compra…");
  const chapters = await readChapters();
  const { bytes } = await downloadFile(photo.fileId);
  const got = await extractNoInvoicePurchase({ mimeType: photo.mime, bytes }, note, chapters);
  const draft: Draft = {
    noInvoice: true,
    file: photo,
    supplier: got.supplier ?? "",
    tax_id: "",
    date: todayISO(),
    number: "",
    items: got.items,
    total,
    chapter: got.chapter,
    payment: "",
    note,
  };
  await showPreview(ctx, { back: data.back, draft }, wait.message_id);
}

// --- Vista previa ------------------------------------------------------------

const paymentLabel = (p: Payment | "") => p === "" ? "elige abajo" : p === "Carlos" ? "Pagó Carlos" : "Caja menor";

function previewText(d: Draft, warning?: string): string {
  const missing = "<i>falta</i>";
  const value = (s: string, required = true) => s ? escapeHtml(s) : required ? missing : "—";
  return [
    `<b>${d.noInvoice ? "Compra sin factura" : "Factura"}</b>`,
    `Proveedor: ${value(d.supplier)}`,
    ...(d.noInvoice ? [] : [`NIT: ${value(d.tax_id, false)}`]),
    `Fecha: ${d.date ? shortDate(d.date) : missing}`,
    ...(d.noInvoice ? [`Nota: ${escapeHtml(d.note)}`] : [`Número: ${value(d.number, false)}`]),
    `Ítems: ${value(d.items)}`,
    `Total: ${d.total === null ? missing : formatPesos(d.total)}`,
    `Capítulo: ${value(d.chapter)}`,
    `Pago: ${paymentLabel(d.payment)}`,
    ...(warning ? ["", warning] : []),
  ].join("\n");
}

function previewKeyboard(d: Draft): Keyboard {
  if (!d.payment) {
    return [
      [button("Caja menor", "gas:p:caja"), button("Pagó Carlos", "gas:p:carlos")],
      [button("Corregir campo", "gas:c"), button("Cancelar", "gas:x")],
    ];
  }
  return [
    [button("Sí, guardar", "gas:ok"), button("Corregir campo", "gas:c")],
    [button("Cancelar", "gas:x")],
  ];
}

/** Muestra la vista previa editando `editId` o en un mensaje nuevo. */
async function showPreview(ctx: Context, data: Data, editId?: number, warning?: string): Promise<void> {
  const d = data.draft!;
  let msg = editId;
  if (editId) await editMessageText(ctx.chatId, editId, previewText(d, warning), previewKeyboard(d));
  else msg = (await ctx.reply(previewText(d, warning), previewKeyboard(d))).message_id;
  await save(ctx, "vista", { back: data.back, draft: d, msg });
}

function fieldKeyboard(d: Draft): Keyboard {
  const fields: Field[] = d.noInvoice
    ? ["supplier", "date", "items", "total", "chapter", "payment"]
    : ["supplier", "tax_id", "date", "number", "items", "total", "chapter", "payment"];
  const rows: Keyboard = [];
  for (let i = 0; i < fields.length; i += 2) {
    rows.push(fields.slice(i, i + 2).map((f) => button(FIELD_NAMES[f], `gas:f:${f}`)));
  }
  rows.push([button("Volver", "gas:v")]);
  return rows;
}

/** Avisa a Carlos por privado que una compra con caja menor pasa del tope. Devuelve si avisó. */
async function notifyOverCap(ctx: Context, d: Draft, cfg: Config): Promise<boolean> {
  if (ctx.role === "carlos" && ctx.place === "private") return false;
  const who = ctx.role === "carlos" ? "Registraste" : "Tu hermano registró";
  await sendMessage(
    { chatId: envNumber("CARLOS_TG_ID") },
    `⚠️ ${who} con caja menor una compra de ${formatPesos(d.total ?? 0)} en ${
      escapeHtml(d.supplier || "un proveedor")
    }. ` +
      `Pasa del tope de ${formatPesos(cfg.tope_compra_caja_menor)}: queda como «Pagó Carlos».`,
  );
  return true;
}

/** Compra con caja menor por encima del tope: pasa a «Pagó Carlos». Devuelve el aviso o null. */
async function applyCap(ctx: Context, d: Draft, cfg: Config): Promise<string | null> {
  if (d.payment !== "caja menor" || d.total === null || d.total <= cfg.tope_compra_caja_menor) return null;
  d.payment = "Carlos";
  const told = await notifyOverCap(ctx, d, cfg);
  return `⚠️ Pasa del tope de la caja menor (${
    formatPesos(cfg.tope_compra_caja_menor)
  }): se registra como «Pagó Carlos».${told && ctx.role === "hermano" ? " Ya le avisé a Carlos." : ""}`;
}

// --- Botones «gas:…» -----------------------------------------------------------

export async function onButton(ctx: Context): Promise<void> {
  const cb = ctx.callback!;
  const session = await readSession<Data>(ctx.chatId, ctx.userId);
  if (!session || session.flujo !== FLOW || !isActiveButton(session, ctx)) {
    await answerCallback(cb.id, "Ese botón ya no está activo.");
    return;
  }
  const [, action, value] = (cb.data ?? "").split(":");
  const data = session.datos;
  const messageId = cb.message!.message_id;
  const d = data.draft;

  if (action === "x") {
    await answerCallback(cb.id);
    await editMessageText(ctx.chatId, messageId, "Cancelado. No guardé nada.");
    await finish(ctx, data.back);
    return;
  }
  if (action === "sf" && session.paso === "foto") {
    await answerCallback(cb.id);
    await startNoInvoice(ctx, data, messageId);
    return;
  }
  if (!d || session.paso !== "vista") {
    await answerCallback(cb.id, "Ese botón ya no está activo.");
    return;
  }
  if (action === "p") {
    await answerCallback(cb.id);
    d.payment = value === "caja" ? "caja menor" : "Carlos";
    const warning = await applyCap(ctx, d, readConfig((await readTabs(["Config"])).Config));
    await showPreview(ctx, data, messageId, warning ?? undefined);
    return;
  }
  if (action === "c") {
    await answerCallback(cb.id);
    await editKeyboard(ctx.chatId, messageId, fieldKeyboard(d));
    return;
  }
  if (action === "v") {
    await answerCallback(cb.id);
    await editKeyboard(ctx.chatId, messageId, previewKeyboard(d));
    return;
  }
  if (action === "f" && value in FIELD_NAMES) {
    await answerCallback(cb.id);
    await chooseField(ctx, data, value as Field, messageId);
    return;
  }
  if (action === "cap") {
    await answerCallback(cb.id);
    const chapter = (await readChapters())[Number(value)];
    if (chapter) d.chapter = chapter;
    await showPreview(ctx, data, messageId);
    return;
  }
  if (action === "ok") {
    await saveExpense(ctx, session, messageId);
    return;
  }
  await answerCallback(cb.id);
}

async function chooseField(ctx: Context, data: Data, field: Field, messageId: number): Promise<void> {
  const d = data.draft!;
  if (field === "chapter") {
    const chapters = await readChapters();
    const rows: Keyboard = chapters.map((c, i) => [button(short(c), `gas:cap:${i}`)]);
    rows.push([button("Volver", "gas:v")]);
    await editKeyboard(ctx.chatId, messageId, rows);
    return;
  }
  if (field === "payment") {
    d.payment = "";
    await showPreview(ctx, data, messageId);
    return;
  }
  await editKeyboard(ctx.chatId, messageId);
  await save(ctx, "campo", { ...data, field, msg: undefined });
  await ctx.reply(ASK_FIELD[field] ?? `Escribe ${FIELD_NAMES[field].toLowerCase()}.`);
}

// --- Mensajes mientras el flujo está abierto ---------------------------------

export async function resume(ctx: Context, session: Session<Data>): Promise<void> {
  const data = session.datos;
  const m = ctx.message!;
  switch (session.paso) {
    case "foto": {
      const file = ctx.messages.map(invoiceFileOf).find((f) => f !== null);
      if (file) return await receiveInvoice(ctx, file, data.back);
      await ctx.reply("Estoy esperando la foto o el PDF de la factura. Si no hay factura, toca «Sin factura».");
      return;
    }
    case "producto": {
      const photo = ctx.messages.map(imageOf).find((f) => f !== null);
      if (!photo) {
        await ctx.reply("Primero manda la foto del producto.");
        return;
      }
      const note = ctx.messages.map((x) => x.caption?.trim() ?? "").find(Boolean);
      if (note) return await receiveProduct(ctx, data, photo, note);
      await save(ctx, "nota", { ...data, pending: photo });
      await ctx.reply("Escribe la nota: qué es, dónde y cuánto costó.");
      return;
    }
    case "nota": {
      const note = m.text?.trim();
      if (!note || !data.pending) {
        await ctx.reply("Escribe la nota en texto: qué es, dónde y cuánto costó.");
        return;
      }
      return await receiveProduct(ctx, data, data.pending, note);
    }
    case "campo":
      return await setField(ctx, data, m.text?.trim() ?? "");
    default: {
      // Con la vista previa abierta, una factura nueva reemplaza la anterior.
      const file = ctx.messages.map(invoiceFileOf).find((f) => f !== null);
      if (file && session.paso === "vista") return await receiveInvoice(ctx, file, data.back);
      await ctx.reply("Usa los botones de la vista previa.");
    }
  }
}

async function setField(ctx: Context, data: Data, text: string): Promise<void> {
  const d = data.draft!;
  const field = data.field!;
  if (!text) {
    await ctx.reply(ASK_FIELD[field] ?? `Escribe ${FIELD_NAMES[field].toLowerCase()} en texto.`);
    return;
  }
  if (field === "total") {
    const n = parseAmount(text);
    if (n === null) {
      await ctx.reply("No entendí el valor. Escribe por ejemplo 45.300 o 45 mil.");
      return;
    }
    d.total = n;
  } else if (field === "date") {
    const iso = parseDateInput(text, todayISO());
    if (!iso) {
      await ctx.reply("No entendí la fecha. Escribe por ejemplo 24/10 o ayer.");
      return;
    }
    d.date = iso;
  } else if (field !== "chapter" && field !== "payment") {
    d[field] = text;
  }
  await showPreview(ctx, { back: data.back, draft: d });
}

// --- Guardar -----------------------------------------------------------------

function invoiceFileName(d: Draft): string {
  const clean = (s: string) => s.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
  const total = formatPesos(d.total ?? 0).replace("$", "");
  const supplier = clean(d.supplier) || "Compra";
  const name = d.noInvoice
    ? `${d.date} ${supplier} sin factura - ${total}`
    : `${d.date} ${supplier} ${clean(d.number) || "sin número"} - ${total}`;
  return `${name}.${d.file.extension}`;
}

async function saveExpense(ctx: Context, session: Session<Data>, messageId: number): Promise<void> {
  const cb = ctx.callback!;
  const data = session.datos;
  const d = data.draft!;
  if (!d.payment) {
    await answerCallback(cb.id, "Elige primero «Caja menor» o «Pagó Carlos».");
    return;
  }
  if (!d.date || d.total === null) {
    await answerCallback(cb.id, `Falta ${!d.date ? "la fecha" : "el total"}. Toca «Corregir campo».`);
    return;
  }
  if (!(await claimStep(ctx.chatId, ctx.userId, "vista", "guardando"))) {
    await answerCallback(cb.id, "Ya lo estoy guardando.");
    return;
  }
  await answerCallback(cb.id);

  let link = "";
  let cfg!: Config;
  try {
    // Controles con la hoja de este momento.
    const { Config, Gastos } = await readTabs(["Config", "Gastos"]);
    cfg = readConfig(Config);
    if (d.noInvoice) {
      const problem = d.total > cfg.compra_sin_factura_max
        ? `Sin factura solo se aceptan compras de hasta ${
          formatPesos(cfg.compra_sin_factura_max)
        }. Corrige el total o pide la factura.`
        : countNoInvoiceToday(Gastos, todayISO()) >= cfg.compras_sin_factura_por_dia
        ? `Hoy ya se registró el máximo de compras sin factura (${cfg.compras_sin_factura_por_dia}). Pide la factura.`
        : null;
      if (problem) {
        await showPreview(ctx, data, messageId, `⚠️ ${problem}`);
        return;
      }
    }
    const capWarning = await applyCap(ctx, d, cfg);
    if (capWarning) {
      await showPreview(ctx, data, messageId, capWarning);
      return;
    }
    const folder = await topFolder(FOLDERS.invoices);
    const { bytes } = await downloadFile(d.file.fileId);
    const uploaded = await uploadFile({ name: invoiceFileName(d), parent: folder.id, mimeType: d.file.mime, bytes });
    link = uploaded.webViewLink ?? "";
    await appendRow("Gastos", {
      fecha: d.date,
      proveedor: d.supplier,
      nit: d.tax_id,
      numero_factura: d.number,
      items: d.items,
      capitulo: d.chapter,
      valor: d.total,
      medio_pago: d.payment,
      cuenta_12M: "sí",
      registrado_por: roleLabel(ctx),
      registrado_el: todayISO(),
      enlace_factura: link,
      nota: d.noInvoice ? `Sin factura. ${d.note}` : "",
    });
  } catch (e) {
    // No quedó guardado: se puede volver a tocar «Sí, guardar».
    await save(ctx, "vista", data);
    throw e;
  }

  await editMessageText(ctx.chatId, messageId, `${previewText(d)}\n\n✅ Guardado.`);
  const fresh = await readTabs(["Gastos", "Pagos"]);
  const balance = pettyCashBalance(cfg, fresh.Gastos, fresh.Pagos);
  const where = d.supplier ? ` en ${escapeHtml(d.supplier)}` : "";
  const file = link ? ` <a href="${link}">Factura en Drive</a>` : "";
  await ctx.reply(
    `Guardé ${formatPesos(d.total)}${where} (${paymentLabel(d.payment)}). Caja menor: ${formatPesos(balance)}.${file}`,
  );
  await finish(ctx, data.back);
}

/** Cierra el flujo y, si vino del reporte, vuelve a él. */
async function finish(ctx: Context, back?: ReturnTo): Promise<void> {
  if (back) return await report.resumeAfterExpense(ctx, back);
  await deleteSession(ctx.chatId, ctx.userId);
}
