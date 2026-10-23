// Procesa un update en segundo plano: duplicados, álbumes, enrutado y errores.

import { bufferAlbumUpdate, isNewUpdate, latestAlbumUpdate, logError, takeAlbum } from "../_shared/db.ts";
import { envNumber } from "../_shared/env.ts";
import { type Message, sendMessage, type Update } from "../_shared/telegram.ts";
import { createContext, roleOf } from "./context.ts";
import { route } from "./router.ts";

const ALBUM_WAIT_MS = 3_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function processUpdate(update: Update): Promise<void> {
  try {
    // Filtro rápido: de otras personas no se guarda nada ni se responde.
    const senderId = update.callback_query?.from.id ?? update.message?.from?.id;
    if (!roleOf(senderId)) return;
    if (!(await isNewUpdate(update.update_id))) return;

    let album: Message[] = [];
    const groupId = update.message?.media_group_id;
    if (groupId) {
      // Álbum: llegan varios updates. Solo el último, tras unos segundos sin fotos nuevas, lo procesa.
      const mine = await bufferAlbumUpdate(groupId, update);
      await sleep(ALBUM_WAIT_MS);
      if ((await latestAlbumUpdate(groupId)) !== mine) return;
      const updates = (await takeAlbum(groupId)) as Update[];
      if (!updates.length) return;
      album = updates.map((u) => u.message!).filter(Boolean);
    }

    const ctx = createContext(update, album);
    if (!ctx) return;
    try {
      await route(ctx);
    } catch (e) {
      await reportError(`update ${update.update_id}`, e);
      if (ctx.role === "hermano") {
        await ctx.reply("No pude procesar eso. Ya le avisé a Carlos.").catch(() => {});
      }
    }
  } catch (e) {
    await reportError(`update ${update.update_id}`, e);
  }
}

/** Guarda el error y avisa a Carlos por privado con una línea corta. */
export async function reportError(context: string, e: unknown): Promise<void> {
  const detail = e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e);
  console.error(context, detail);
  await logError(context, detail).catch(() => {});
  const line = (e instanceof Error ? e.message : String(e)).slice(0, 200);
  await sendMessage({ chatId: envNumber("CARLOS_TG_ID") }, `⚠️ Error (${context}): ${line}`).catch(() => {});
}
