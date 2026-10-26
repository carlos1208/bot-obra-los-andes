// Errores: se guardan en la tabla errores y le llega a Carlos una línea corta por privado.

import { logError } from "./db.ts";
import { envNumber } from "./env.ts";
import { sendMessage } from "./telegram.ts";

/** Guarda el error y avisa a Carlos por privado con una línea corta. */
export async function reportError(context: string, e: unknown): Promise<void> {
  const detail = e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e);
  console.error(context, detail);
  await logError(context, detail).catch(() => {});
  const line = (e instanceof Error ? e.message : String(e)).slice(0, 200);
  await sendMessage({ chatId: envNumber("CARLOS_TG_ID") }, `⚠️ Error (${context}): ${line}`).catch(() => {});
}
