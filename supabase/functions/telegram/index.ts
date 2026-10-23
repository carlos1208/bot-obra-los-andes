// Webhook de Telegram. Verifica el secreto, responde 200 de inmediato y procesa en segundo plano.

import { env } from "../_shared/env.ts";
import type { Update } from "../_shared/telegram.ts";
import { processUpdate } from "./process.ts";

function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

function runInBackground(task: Promise<unknown>): void {
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
  if (runtime) runtime.waitUntil(task);
  else task.catch((e) => console.error(e));
}

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
