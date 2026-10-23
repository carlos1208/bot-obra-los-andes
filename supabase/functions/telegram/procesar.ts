// Procesa un update en segundo plano: duplicados, álbumes, enrutado y errores.

import { esUpdateNuevo, guardarEnAlbum, registrarError, tomarAlbum, ultimoDelAlbum } from "../_shared/db.ts";
import { envNumero } from "../_shared/env.ts";
import { enviar, type Mensaje, type Update } from "../_shared/telegram.ts";
import { crearContexto, rolDe } from "./contexto.ts";
import { enrutar } from "./router.ts";

const ESPERA_ALBUM_MS = 3_000;

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function procesar(update: Update): Promise<void> {
  try {
    // Filtro rápido: de otras personas no se guarda nada ni se responde.
    const remitente = update.callback_query?.from.id ?? update.message?.from?.id;
    if (!rolDe(remitente)) return;
    if (!(await esUpdateNuevo(update.update_id))) return;

    let mensajes: Mensaje[] = [];
    const grupo = update.message?.media_group_id;
    if (grupo) {
      // Álbum: llegan varios updates. Solo el último, tras unos segundos sin fotos nuevas, lo procesa.
      const mio = await guardarEnAlbum(grupo, update);
      await dormir(ESPERA_ALBUM_MS);
      if ((await ultimoDelAlbum(grupo)) !== mio) return;
      const updates = (await tomarAlbum(grupo)) as Update[];
      if (!updates.length) return;
      mensajes = updates.map((u) => u.message!).filter(Boolean);
    }

    const ctx = crearContexto(update, mensajes);
    if (!ctx) return;
    try {
      await enrutar(ctx);
    } catch (e) {
      await reportarError(`update ${update.update_id}`, e);
      if (ctx.rol === "hermano") {
        await ctx.responder("No pude procesar eso. Ya le avisé a Carlos.").catch(() => {});
      }
    }
  } catch (e) {
    await reportarError(`update ${update.update_id}`, e);
  }
}

/** Guarda el error y avisa a Carlos por privado con una línea corta. */
export async function reportarError(contexto: string, e: unknown): Promise<void> {
  const detalle = e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e);
  console.error(contexto, detalle);
  await registrarError(contexto, detalle).catch(() => {});
  const linea = (e instanceof Error ? e.message : String(e)).slice(0, 200);
  await enviar({ chatId: envNumero("CARLOS_TG_ID") }, `⚠️ Error (${contexto}): ${linea}`).catch(() => {});
}
