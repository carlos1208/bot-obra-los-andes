// Activa el webhook con secret_token y registra los comandos del bot.
// Uso: deno task webhook
import { cargarEnv, requerido } from "./_env.ts";

await cargarEnv();
const token = requerido("TELEGRAM_BOT_TOKEN");
const secreto = requerido("TELEGRAM_WEBHOOK_SECRET");
const ref = requerido("PROJECT_REF");

async function tg(metodo: string, params: Record<string, unknown> = {}) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${metodo}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const d = await r.json();
  if (!d.ok) throw new Error(`${metodo}: ${d.description}`);
  return d.result;
}

const url = `https://${ref}.supabase.co/functions/v1/telegram`;
await tg("setWebhook", {
  url,
  secret_token: secreto,
  allowed_updates: ["message", "callback_query"],
  drop_pending_updates: true,
  max_connections: 10,
});
await tg("setMyCommands", {
  commands: [
    { command: "estado", description: "Semana de obra, tareas de hoy y disponible" },
    { command: "antes", description: "Subir fotos ANTES (Carlos)" },
  ],
});
const info = await tg("getWebhookInfo");
console.log(`Webhook activo: ${info.url}`);
console.log(`Pendientes: ${info.pending_update_count}`);
if (info.last_error_message) console.log(`Último error: ${info.last_error_message}`);
