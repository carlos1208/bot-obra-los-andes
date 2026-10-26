// Mensaje libre por privado (texto o nota de voz): Gemini dice si es un pago, una reposición de caja menor
// o una pregunta, y trae los datos de cada caso. Lo usan el enrutador y el flujo /pago.

import { interpretMessage, type PrivateMessage } from "../../_shared/extractors.ts";
import { shortDate, todayISO } from "../../_shared/format.ts";
import { readTabs } from "../../_shared/sheets.ts";
import { budgetChapters, payeesOf, readMilestones } from "../../_shared/site.ts";
import { downloadFile } from "../../_shared/telegram.ts";
import type { Context } from "../context.ts";

export interface Interpreted {
  got: PrivateMessage;
  /** Mensaje «Un momento…»: se edita con la vista previa o la respuesta. */
  wait: number;
}

/** null si el mensaje no es texto ni nota de voz. */
export async function interpret(ctx: Context): Promise<Interpreted | null> {
  const m = ctx.message!;
  const text = m.text?.trim();
  if (!text && !m.voice) return null;
  const wait = await ctx.reply(m.voice ? "Escuchando…" : "Un momento…");
  const { Pagos, Hitos, Presupuesto } = await readTabs(["Pagos", "Hitos", "Presupuesto"]);
  const input = m.voice ? { mimeType: "audio/ogg", bytes: (await downloadFile(m.voice.file_id)).bytes } : text!;
  const today = todayISO();
  const got = await interpretMessage(input, {
    fromCarlos: ctx.role === "carlos",
    today: `${shortDate(today)} de ${today.slice(0, 4)} (${today})`,
    payees: payeesOf(Pagos),
    milestones: readMilestones(Hitos).map((h) => ({ code: h.hito, name: h.nombre })),
    chapters: budgetChapters(Presupuesto),
  });
  return { got: { ...got, transcript: text ?? got.transcript }, wait: wait.message_id };
}
