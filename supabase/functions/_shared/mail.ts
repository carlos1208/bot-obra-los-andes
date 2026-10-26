// Facturas del correo de Carlos por medio de su Apps Script (apps-script/correo.gs), solo cuando él lo pide.
// GMAIL_SCRIPT_URL es la URL de la app web y GMAIL_SCRIPT_SECRET el secreto que el script compara.

import { env } from "./env.ts";

export interface MailInvoice {
  id: string;
  fecha: string; // ISO
  nit: string;
  empresa: string;
  numero: string;
  remitente: string;
}

export interface MailInvoiceFiles {
  sender: string;
  pdf: Uint8Array<ArrayBuffer> | null;
  xml: string | null;
}

async function callScript<T>(body: Record<string, unknown>): Promise<T> {
  const r = await fetch(env("GMAIL_SCRIPT_URL"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secreto: env("GMAIL_SCRIPT_SECRET"), ...body }),
    redirect: "follow", // la app web responde con una redirección
    signal: AbortSignal.timeout(45_000),
  });
  const text = await r.text();
  let data: T & { error?: string };
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Apps Script ${r.status}: no respondió JSON (¿está publicado como app web?)`);
  }
  if (data.error) throw new Error(`Apps Script: ${data.error}`);
  return data;
}

/** Facturas electrónicas de los últimos `days` días que no tienen la etiqueta de registradas. */
export async function searchMailInvoices(days: number): Promise<MailInvoice[]> {
  return (await callScript<{ facturas: MailInvoice[] }>({ accion: "buscar", dias: days })).facturas;
}

/** El PDF y el XML de la factura, sacados del .zip del correo. */
export async function fetchMailInvoice(id: string): Promise<MailInvoiceFiles> {
  const got = await callScript<{ remitente: string; pdf: string | null; xml: string | null }>({
    accion: "factura",
    id,
  });
  return {
    sender: got.remitente ?? "",
    pdf: got.pdf ? Uint8Array.from(atob(got.pdf), (c) => c.charCodeAt(0)) : null,
    xml: got.xml,
  };
}

/** Etiqueta el correo para que no vuelva a salir en /correo. */
export async function markMailInvoice(id: string): Promise<void> {
  await callScript({ accion: "marcar", id });
}
