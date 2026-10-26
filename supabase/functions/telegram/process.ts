// Procesa un update en segundo plano: duplicados, álbumes, enrutado y errores.

import {
  bufferAlbumUpdate,
  claimDueRetries,
  deleteRetry,
  enqueueRetry,
  isNewUpdate,
  latestAlbumUpdate,
  rescheduleRetry,
  takeAlbum,
} from "../_shared/db.ts";
import { reportError } from "../_shared/errors.ts";
import { isQuotaError } from "../_shared/gemini.ts";
import type { Message, Update } from "../_shared/telegram.ts";
import { type Context, createContext, roleOf } from "./context.ts";
import { route } from "./router.ts";

/** Tiempos de espera. Las pruebas los acortan. */
export const timing = {
  /** Sin fotos nuevas durante este tiempo, el álbum está completo. */
  albumWaitMs: 3_000,
  /** Gemini sin cuota (429): primer reintento. */
  retryWaitMs: 65_000,
};
/** Esperas crecientes (en minutos) de los reintentos siguientes. Después de la última, se rinde. */
const RETRY_MINUTES = [2, 5, 10, 20, 40, 60, 60, 60];

/** Lo que se guarda en la cola: el update y, si era un álbum, sus mensajes. */
interface QueuedPayload {
  update: Update;
  album: Message[];
}

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
      await sleep(timing.albumWaitMs);
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
      if (!isQuotaError(e)) {
        await failed(ctx, `update ${update.update_id}`, e);
      } else {
        // Gemini sin cuota: a la cola, aviso corto y un reintento en este mismo proceso.
        await enqueueRetry({ update, album } satisfies QueuedPayload, String(e), timing.retryWaitMs);
        await ctx.reply("Lo proceso en unos minutos.").catch(() => {});
        await sleep(timing.retryWaitMs);
      }
    }
  } catch (e) {
    await reportError(`update ${update.update_id}`, e);
  }
  await drainRetries();
}

async function failed(ctx: Context, context: string, e: unknown): Promise<void> {
  await reportError(context, e);
  if (ctx.role === "hermano") {
    await ctx.reply("No pude procesar eso. Ya le avisé a Carlos.").catch(() => {});
  }
}

/** Procesa los reintentos vencidos. Si Gemini sigue sin cuota, espera más; al final se rinde y avisa. */
export async function drainRetries(): Promise<void> {
  try {
    for (const item of await claimDueRetries()) {
      const { update, album } = item.update as QueuedPayload;
      const ctx = createContext(update, album ?? []);
      if (!ctx) {
        await deleteRetry(item.id);
        continue;
      }
      try {
        await route(ctx);
        await deleteRetry(item.id);
      } catch (e) {
        const attempt = item.intentos + 1;
        if (isQuotaError(e) && attempt <= RETRY_MINUTES.length) {
          await rescheduleRetry(item.id, attempt, RETRY_MINUTES[attempt - 1] * 60_000, String(e));
          continue;
        }
        await deleteRetry(item.id);
        await failed(ctx, `reintento del update ${update.update_id}`, e);
        if (ctx.role === "carlos") await ctx.reply("No pude procesarlo. Mándalo de nuevo.").catch(() => {});
      }
    }
  } catch (e) {
    await reportError("cola de reintentos", e);
  }
}
