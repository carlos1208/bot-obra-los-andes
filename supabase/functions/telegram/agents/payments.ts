// Pagos (solo Carlos, por su privado): texto o voz → Gemini → vista previa → «Sí, guardar» o «Corregir campo».
// Nada se escribe en la hoja hasta «Sí, guardar». El pago no se liga a un hito: Hitos lo maneja Carlos.
// Al guardar: fila en Pagos. La reposición de caja menor va a Pagos con a_quien = Caja menor y cuenta_12M = no,
// y responde con el arqueo: efectivo esperado + facturas sin reponer = fondo_caja_menor.

import { claimStep, deleteSession, readSession, saveSession, type Session } from "../../_shared/db.ts";
import type { PrivateMessage } from "../../_shared/extractors.ts";
import {
  escapeHtml,
  formatPesos,
  normalize,
  parseAmount,
  parseDateInput,
  shortDate,
  todayISO,
} from "../../_shared/format.ts";
import { appendRow, readTabs } from "../../_shared/sheets.ts";
import {
  available12M,
  budgetChapters,
  isPettyCash,
  masonPaid,
  PAYEES,
  pettyCashBalance,
  pettyCashToRefill,
  readConfig,
  type Row,
} from "../../_shared/site.ts";
import { answerCallback, editKeyboard, editMessageText, type Keyboard } from "../../_shared/telegram.ts";
import type { Context } from "../context.ts";
import { button, type FlowBase, isActiveButton, short } from "../ui.ts";
import { interpret } from "./interpret.ts";

/** Valor de sesiones.flujo para este flujo. */
export const FLOW = "pago";

const REFILL_CONCEPT = "Reposición de caja menor";
const EXAMPLE = "«le pagué 700 mil al albañil por Nequi» o «repuse 230 mil de caja menor»";

type Field = "payee" | "concept" | "amount" | "method" | "date" | "chapter";

const FIELD_NAMES: Record<Field, string> = {
  payee: "A quién",
  concept: "Concepto",
  amount: "Valor",
  method: "Medio",
  date: "Fecha",
  chapter: "Capítulo",
};

const ASK_FIELD: Partial<Record<Field, string>> = {
  payee: "Escribe a quién se le pagó.",
  concept: "Escribe el concepto.",
  amount: "Escribe el valor (por ejemplo 700.000 o 700 mil).",
  method: "Escribe el medio de pago (Nequi, efectivo, transferencia…).",
  date: "Escribe la fecha (por ejemplo 24/10 o ayer).",
};

interface Draft {
  payee: string;
  concept: string;
  amount: number | null;
  method: string;
  date: string;
  chapter: string;
}

interface Data extends FlowBase {
  draft?: Draft;
  field?: Field;
}

async function save(ctx: Context, step: string, data: Data): Promise<void> {
  await saveSession(ctx.chatId, ctx.userId, FLOW, step, { ...data, hilo: ctx.threadId ?? null });
}

/** Pagos solo los registra Carlos, en su privado. Devuelve si puede seguir. */
async function allowed(ctx: Context): Promise<boolean> {
  if (ctx.role !== "carlos") {
    await ctx.reply("Los pagos los registra Carlos.");
    return false;
  }
  if (ctx.place !== "private") {
    await ctx.reply("Los pagos van por tu privado con el bot.");
    return false;
  }
  return true;
}

// --- Inicio ------------------------------------------------------------------

/** /pago: espera el pago en texto o voz. */
export async function start(ctx: Context): Promise<void> {
  if (!(await allowed(ctx))) return;
  const m = await ctx.reply(`Escribe o dicta el pago. Por ejemplo: ${EXAMPLE}.`, [[button("Cancelar", "pag:x")]]);
  await save(ctx, "nota", { msg: m.message_id });
}

/** Lo que entendió Gemini de un pago o una reposición → vista previa (editando el «Un momento…»). */
export async function fromMessage(ctx: Context, got: PrivateMessage, wait: number): Promise<void> {
  const today = todayISO();
  const refill = got.kind === "reposicion" || isPettyCash(got.payee);
  const draft: Draft = {
    payee: refill ? "Caja menor" : canonicalPayee(got.payee ?? ""),
    concept: refill ? REFILL_CONCEPT : got.concept?.trim() ?? "",
    amount: got.amount,
    method: got.method?.trim() ?? "",
    date: (got.date && parseDateInput(got.date, today)) || today,
    chapter: refill ? "" : got.chapter,
  };
  await showPreview(ctx, { draft }, wait);
}

/** El nombre de la lista si coincide (sin tildes ni mayúsculas); si no, como se escribió. */
function canonicalPayee(name: string): string {
  return PAYEES.find((p) => normalize(p) === normalize(name)) ?? name.trim();
}

// --- Vista previa ------------------------------------------------------------

interface Sheet {
  Config: Row[];
  Pagos: Row[];
  Gastos: Row[];
}

const readSheet = (): Promise<Sheet> => readTabs(["Config", "Pagos", "Gastos"]);

function previewText(d: Draft, sheet: Sheet, notice?: string, saved = false): string {
  const cfg = readConfig(sheet.Config);
  const missing = "<i>falta</i>";
  const value = (s: string) => s ? escapeHtml(s) : "—";
  const refill = isPettyCash(d.payee);
  const lines = refill
    ? [
      "<b>Reposición de caja menor</b>",
      `Valor: ${d.amount === null ? missing : formatPesos(d.amount)}`,
      `Medio: ${value(d.method)}`,
      `Fecha: ${shortDate(d.date)}`,
      "Cuenta en los 12 M: no",
    ]
    : [
      "<b>Pago</b>",
      `A quién: ${d.payee ? escapeHtml(d.payee) : missing}`,
      `Concepto: ${value(d.concept)}`,
      `Valor: ${d.amount === null ? missing : formatPesos(d.amount)}`,
      `Medio: ${value(d.method)}`,
      `Fecha: ${shortDate(d.date)}`,
      `Capítulo: ${value(d.chapter)}`,
      "Cuenta en los 12 M: sí",
    ];
  if (saved) return lines.join("\n");

  const notes: string[] = [];
  if (refill) {
    const toRefill = pettyCashToRefill(cfg, sheet.Gastos, sheet.Pagos);
    notes.push(
      `Hoy: efectivo esperado ${formatPesos(pettyCashBalance(cfg, sheet.Gastos, sheet.Pagos))} y facturas sin reponer ${
        formatPesos(toRefill)
      }.`,
    );
  } else {
    const limit = cfg.total_albanil + cfg.reserva_albanil;
    const paid = masonPaid(sheet.Pagos) + (d.amount ?? 0);
    if (normalize(d.payee) === "albanil" && paid > limit) {
      notes.push(
        `⚠️ Con este pago, al albañil se le habrán pagado ${formatPesos(paid)}: pasa de ${formatPesos(limit)} ` +
          `(total ${formatPesos(cfg.total_albanil)} + reserva ${formatPesos(cfg.reserva_albanil)}).`,
      );
    }
  }
  return [...lines, ...(notes.length ? ["", ...notes] : []), ...(notice ? ["", notice] : [])].join("\n");
}

const PREVIEW_KEYBOARD: Keyboard = [
  [button("Sí, guardar", "pag:ok"), button("Corregir campo", "pag:c")],
  [button("Cancelar", "pag:x")],
];

/** Muestra la vista previa editando `editId` o en un mensaje nuevo. Lee la hoja en este momento. */
async function showPreview(ctx: Context, data: Data, editId?: number, notice?: string): Promise<void> {
  const d = data.draft!;
  const sheet = await readSheet();
  const text = previewText(d, sheet, notice);
  let msg = editId;
  if (editId) await editMessageText(ctx.chatId, editId, text, PREVIEW_KEYBOARD);
  else msg = (await ctx.reply(text, PREVIEW_KEYBOARD)).message_id;
  await save(ctx, "vista", { draft: d, msg });
}

function fieldKeyboard(d: Draft): Keyboard {
  const fields: Field[] = isPettyCash(d.payee)
    ? ["payee", "amount", "method", "date"]
    : ["payee", "concept", "amount", "method", "date", "chapter"];
  const rows: Keyboard = [];
  for (let i = 0; i < fields.length; i += 2) {
    rows.push(fields.slice(i, i + 2).map((f) => button(FIELD_NAMES[f], `pag:f:${f}`)));
  }
  rows.push([button("Volver", "pag:v")]);
  return rows;
}

// --- Botones «pag:…» -----------------------------------------------------------

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
    await deleteSession(ctx.chatId, ctx.userId);
    return;
  }
  if (!d || session.paso !== "vista") {
    await answerCallback(cb.id, "Ese botón ya no está activo.");
    return;
  }
  await answerCallback(cb.id);
  switch (action) {
    case "ok":
      return await savePayment(ctx, session, messageId);
    case "c":
      await editKeyboard(ctx.chatId, messageId, fieldKeyboard(d));
      return;
    case "v":
      return await showPreview(ctx, data, messageId);
    case "f":
      if (value === "payeeText") return await askText(ctx, data, "payee", messageId);
      if (value in FIELD_NAMES) return await chooseField(ctx, data, value as Field, messageId);
      return;
    case "p": {
      // A quién, desde la lista.
      const payee = PAYEES[Number(value)];
      if (payee) setPayee(d, payee);
      return await showPreview(ctx, data, messageId);
    }
    case "cap": {
      const chapter = budgetChapters((await readTabs(["Presupuesto"])).Presupuesto)[Number(value)];
      if (chapter) d.chapter = chapter;
      return await showPreview(ctx, data, messageId);
    }
  }
}

/** Cambiar a quién: a Caja menor es una reposición; desde Caja menor, un pago normal. */
function setPayee(d: Draft, payee: string): void {
  const wasRefill = isPettyCash(d.payee);
  d.payee = canonicalPayee(payee);
  if (isPettyCash(d.payee)) {
    Object.assign(d, { concept: REFILL_CONCEPT, chapter: "" });
  } else if (wasRefill && d.concept === REFILL_CONCEPT) {
    d.concept = "";
  }
}

async function chooseField(ctx: Context, data: Data, field: Field, messageId: number): Promise<void> {
  if (field === "payee") {
    const rows: Keyboard = [];
    for (let i = 0; i < PAYEES.length; i += 2) {
      rows.push(PAYEES.slice(i, i + 2).map((p, k) => button(p, `pag:p:${i + k}`)));
    }
    rows.push([button("Otro (escribir)", "pag:f:payeeText"), button("Volver", "pag:v")]);
    await editKeyboard(ctx.chatId, messageId, rows);
    return;
  }
  if (field === "chapter") {
    const chapters = budgetChapters((await readTabs(["Presupuesto"])).Presupuesto);
    const rows: Keyboard = chapters.map((c, i) => [button(short(c), `pag:cap:${i}`)]);
    rows.push([button("Volver", "pag:v")]);
    await editKeyboard(ctx.chatId, messageId, rows);
    return;
  }
  await askText(ctx, data, field, messageId);
}

/** El campo se escribe: quita los botones y espera el texto. */
async function askText(ctx: Context, data: Data, field: Field, messageId: number): Promise<void> {
  await editKeyboard(ctx.chatId, messageId);
  await save(ctx, "campo", { ...data, field, msg: undefined });
  await ctx.reply(ASK_FIELD[field] ?? `Escribe ${FIELD_NAMES[field].toLowerCase()}.`);
}

// --- Mensajes mientras el flujo está abierto ---------------------------------

export async function resume(ctx: Context, session: Session<Data>): Promise<void> {
  const data = session.datos;
  if (session.paso === "nota") {
    const read = await interpret(ctx);
    if (!read) {
      await ctx.reply(`Escribe o dicta el pago. Por ejemplo: ${EXAMPLE}.`);
      return;
    }
    if (read.got.kind !== "pago" && read.got.kind !== "reposicion") {
      await editMessageText(ctx.chatId, read.wait, `No entendí el pago. Escríbelo así: ${EXAMPLE}.`);
      return;
    }
    return await fromMessage(ctx, read.got, read.wait);
  }
  if (session.paso === "campo") return await setField(ctx, data, ctx.message?.text?.trim() ?? "");
  await ctx.reply("Usa los botones de la vista previa.");
}

async function setField(ctx: Context, data: Data, text: string): Promise<void> {
  const d = data.draft!;
  const field = data.field!;
  if (!text) {
    await ctx.reply(ASK_FIELD[field] ?? `Escribe ${FIELD_NAMES[field].toLowerCase()} en texto.`);
    return;
  }
  if (field === "amount") {
    const n = parseAmount(text);
    if (n === null) {
      await ctx.reply("No entendí el valor. Escribe por ejemplo 700.000 o 700 mil.");
      return;
    }
    d.amount = n;
  } else if (field === "date") {
    const iso = parseDateInput(text, todayISO());
    if (!iso) {
      await ctx.reply("No entendí la fecha. Escribe por ejemplo 24/10 o ayer.");
      return;
    }
    d.date = iso;
  } else if (field === "payee") {
    setPayee(d, text);
  } else if (field === "concept" || field === "method") {
    d[field] = text;
  }
  await showPreview(ctx, { draft: d });
}

// --- Guardar -----------------------------------------------------------------

async function savePayment(ctx: Context, session: Session<Data>, messageId: number): Promise<void> {
  const data = session.datos;
  const d = data.draft!;
  if (!d.payee || d.amount === null) {
    const what = !d.payee ? "a quién se le pagó" : "el valor";
    await showPreview(ctx, data, messageId, `⚠️ Falta ${what}. Toca «Corregir campo».`);
    return;
  }
  if (!(await claimStep(ctx.chatId, ctx.userId, "vista", "guardando"))) return;

  const refill = isPettyCash(d.payee);
  let before!: Sheet;
  try {
    before = await readSheet();
    await appendRow("Pagos", {
      fecha: d.date,
      a_quien: d.payee,
      concepto: d.concept,
      capitulo: d.chapter,
      valor: d.amount,
      medio: d.method,
      cuenta_12M: refill ? "no" : "sí",
      registrado_por: "Carlos",
    });
  } catch (e) {
    // No quedó guardado: se puede volver a tocar «Sí, guardar».
    await save(ctx, "vista", data);
    throw e;
  }

  const fresh = await readSheet();
  await editMessageText(ctx.chatId, messageId, `${previewText(d, fresh, undefined, true)}\n\n✅ Guardado.`);
  await deleteSession(ctx.chatId, ctx.userId);
  const cfg = readConfig(fresh.Config);
  if (refill) {
    // Arqueo con la hoja de antes de esta reposición: efectivo esperado + facturas sin reponer = fondo.
    const cash = pettyCashBalance(cfg, before.Gastos, before.Pagos);
    const receipts = pettyCashToRefill(cfg, before.Gastos, before.Pagos);
    await ctx.reply(
      [
        `Guardé la reposición de ${formatPesos(d.amount)}.`,
        "",
        "<b>Arqueo de caja menor</b>",
        `Efectivo esperado antes de reponer: ${formatPesos(cash)}`,
        `Facturas sin reponer: ${formatPesos(receipts)}`,
        `Efectivo + facturas = ${formatPesos(cash + receipts)} (fondo de caja menor)`,
        `Con la reposición, la caja queda en ${formatPesos(pettyCashBalance(cfg, fresh.Gastos, fresh.Pagos))}.`,
        ...(d.amount !== receipts
          ? [`⚠️ Se repusieron ${formatPesos(d.amount)} y las facturas sin reponer suman ${formatPesos(receipts)}.`]
          : []),
      ].join("\n"),
    );
    return;
  }
  const lines = [`Guardé ${formatPesos(d.amount)} a ${escapeHtml(d.payee)}.`];
  if (normalize(d.payee) === "albanil") {
    lines.push(
      `Al albañil se le ha pagado ${formatPesos(masonPaid(fresh.Pagos))} de ${formatPesos(cfg.total_albanil)}.`,
    );
  }
  lines.push(`Disponible de los 12 M: ${formatPesos(available12M(cfg, fresh.Gastos, fresh.Pagos))}.`);
  await ctx.reply(lines.join("\n"));
}
