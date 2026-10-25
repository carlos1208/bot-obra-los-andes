// Ayudas para los flujos con botones: teclados en línea y sesiones ligadas a un tema y a un mensaje.

import type { Session } from "../_shared/db.ts";
import type { Button } from "../_shared/telegram.ts";
import type { Context } from "./context.ts";

export const button = (text: string, data: string): Button => ({ text, callback_data: data });

/** Opción de selección múltiple: ✅ si está elegida. */
export const check = (label: string, on: boolean): string => `${on ? "✅" : "▫️"} ${label}`;

/** Recorta un texto para que el botón se lea en el celular. */
export function short(text: string, max = 38): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** Datos comunes de las sesiones: el tema donde vive el flujo y el mensaje con los botones activos. */
export interface FlowBase {
  hilo?: number | null;
  msg?: number;
}

/** El mensaje llegó al mismo chat y tema donde está el flujo. */
export function sameThread(session: Session<FlowBase>, ctx: Context): boolean {
  return (session.datos.hilo ?? null) === (ctx.threadId ?? null);
}

/** El botón tocado es del mensaje activo del flujo (los mensajes viejos ya no cuentan). */
export function isActiveButton(session: Session<FlowBase>, ctx: Context): boolean {
  return !session.datos.msg || session.datos.msg === ctx.callback?.message?.message_id;
}

/** Quién registra, como se escribe en la hoja. */
export const roleLabel = (ctx: Context): string => ctx.role === "carlos" ? "Carlos" : "Hermano";
