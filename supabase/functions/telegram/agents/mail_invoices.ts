// /correo (solo Carlos, por privado): busca en su Gmail, solo cuando él lo pide, las facturas electrónicas de
// los últimos días. Las que ya están en Gastos se etiquetan y no vuelven a salir. Con un botón por factura,
// el bot la lee del XML y sigue el flujo de Gastos: vista previa, «Caja menor» o «Pagó Carlos» y «Sí, guardar».

import { reportError } from "../../_shared/errors.ts";
import { escapeHtml, formatPesos, normalize, shortDate, todayISO } from "../../_shared/format.ts";
import { type MailInvoice, markMailInvoice, searchMailInvoices } from "../../_shared/mail.ts";
import { readTabs } from "../../_shared/sheets.ts";
import { answerCallback, editMessageText, type Keyboard } from "../../_shared/telegram.ts";
import type { Context } from "../context.ts";
import { button, short } from "../ui.ts";
import * as expenses from "./expenses.ts";

/** Hasta cuántos días atrás busca. */
export const DAYS = 30;
/** Botones de facturas en un mensaje. */
const MAX_LISTED = 10;

const invoiceKey = (s: unknown) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
/** Fecha del correo en Bogotá (llega en ISO, UTC). */
const mailDate = (iso: string) => todayISO(new Date(iso));

const SMALL_WORDS = new Set(["de", "del", "la", "las", "los", "y", "e"]);
/** «EASY ALTOS DEL PRADO» → «Easy Altos del Prado» (las siglas con punto quedan igual: «S.A.S.»). */
function titleCase(text: string): string {
  return text.trim().split(/\s+/).map((w, i) => {
    if (w.includes(".")) return w.toUpperCase();
    const lower = w.toLowerCase();
    return i > 0 && SMALL_WORDS.has(lower) ? lower : lower.charAt(0).toUpperCase() + lower.slice(1);
  }).join(" ");
}

/**
 * Establecimiento, sin IA: la tienda que trae el XML; si no, el dominio del correo cuando el buzón es de la misma
 * empresa (efacturahomecenter@homecenter.co → «Homecenter»; no si lo manda un proveedor de facturación); si no,
 * la razón social del asunto.
 */
export function storeOf(f: MailInvoice): string {
  if (f.tienda) return titleCase(f.tienda);
  const [, local, domain] = f.remitente.match(/([^\s<]+)@([^\s>]+)/) ?? [];
  const company = domain?.split(".")[0];
  if (company && company.length > 2 && normalize(local).includes(normalize(company))) return titleCase(company);
  return titleCase(f.empresa);
}

const dateOf = (f: MailInvoice) => shortDate(f.fechaFactura ?? mailDate(f.fecha));
/** El total o, con un script viejo (sin total), el número de la factura. */
const valueOf = (f: MailInvoice) => typeof f.total === "number" ? formatPesos(f.total) : `factura ${f.numero}`;

/** Línea de la lista: «lun 19 oct · Homecenter · $215.700». */
const summary = (f: MailInvoice) => `${dateOf(f)} · ${storeOf(f)} · ${valueOf(f)}`;
/** Botón: el valor primero, para que si se recorta sea el nombre de la tienda. */
const buttonLabel = (f: MailInvoice) => short(`${valueOf(f)} · ${dateOf(f).replace(/^\S+ /, "")} · ${storeOf(f)}`, 40);

export async function start(ctx: Context): Promise<void> {
  if (ctx.role !== "carlos") {
    await ctx.reply("Las facturas del correo las registra Carlos.");
    return;
  }
  if (ctx.place !== "private") {
    await ctx.reply("Escríbeme /correo por tu privado.");
    return;
  }
  const wait = await ctx.reply("Buscando facturas en tu correo…");
  const found = await searchMailInvoices(DAYS);
  const { Gastos } = await readTabs(["Gastos"]);
  const registered = new Set(Gastos.map((r) => invoiceKey(r.numero_factura)).filter(Boolean));
  const already = found.filter((f) => registered.has(invoiceKey(f.numero)));
  for (const f of already) {
    await markMailInvoice(f.id).catch((e) => reportError("etiquetar una factura ya registrada", e));
  }
  const fresh = found.filter((f) => !registered.has(invoiceKey(f.numero)))
    .sort((a, b) => b.fecha.localeCompare(a.fecha));
  const note = already.length
    ? `${already.length === 1 ? "1 ya estaba" : `${already.length} ya estaban`} en Gastos: ${
      already.length === 1 ? "la marqué" : "las marqué"
    } para que no vuelva${already.length === 1 ? "" : "n"} a salir.`
    : "";

  if (!fresh.length) {
    await editMessageText(
      ctx.chatId,
      wait.message_id,
      [`No hay facturas nuevas en tu correo de los últimos ${DAYS} días.`, note].filter(Boolean).join(" "),
    );
    return;
  }
  const listed = fresh.slice(0, MAX_LISTED);
  const keyboard: Keyboard = listed.map((f) => [button(buttonLabel(f), `cor:f:${f.id}`)]);
  await editMessageText(
    ctx.chatId,
    wait.message_id,
    [
      `<b>Facturas nuevas en tu correo</b> (últimos ${DAYS} días)`,
      ...listed.map((f) => `• ${escapeHtml(summary(f))}`),
      ...(fresh.length > listed.length
        ? [`… y ${fresh.length - listed.length} más (registra estas y vuelve a escribir /correo).`]
        : []),
      "",
      "Toca la que quieres registrar.",
      ...(note ? ["", note] : []),
    ].join("\n"),
    keyboard,
  );
}

/** «cor:f:<id del correo>»: lee esa factura. Los botones sirven mientras el correo no tenga la etiqueta. */
export async function onButton(ctx: Context): Promise<void> {
  const cb = ctx.callback!;
  const [, action, id] = (cb.data ?? "").split(":");
  if (ctx.role !== "carlos" || action !== "f" || !id) {
    await answerCallback(cb.id, "Ese botón ya no está activo.");
    return;
  }
  await answerCallback(cb.id);
  await expenses.receiveMailInvoice(ctx, id);
}
