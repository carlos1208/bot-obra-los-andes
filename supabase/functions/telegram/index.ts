// Webhook de Telegram. Verifica el secreto, responde 200 de inmediato y procesa en segundo plano.

import { env } from "../_shared/env.ts";
import { runInBackground, safeEqual } from "../_shared/runtime.ts";
import type { Update } from "../_shared/telegram.ts";
import { processUpdate } from "./process.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");
  const secret = req.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
  if (!safeEqual(secret, env("TELEGRAM_WEBHOOK_SECRET"))) {
    return new Response("no autorizado", { status: 401 });
  }
  let update: Update;
  try {
    update = await req.json();
  } catch {
    return new Response("ok"); // cuerpo inválido: no tiene sentido que Telegram reintente
  }
  runInBackground(processUpdate(update));
  return new Response("ok");
});
