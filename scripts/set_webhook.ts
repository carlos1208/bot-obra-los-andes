// Activa el webhook con secret_token y registra los comandos del bot.
// Uso: deno task webhook
import { loadEnv, required } from "./_env.ts";
import { tg } from "../supabase/functions/_shared/telegram.ts";

await loadEnv();
required("TELEGRAM_BOT_TOKEN");
const secret = required("TELEGRAM_WEBHOOK_SECRET");
const projectRef = required("PROJECT_REF");

const url = `https://${projectRef}.supabase.co/functions/v1/telegram`;
await tg("setWebhook", {
  url,
  secret_token: secret,
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
const info = await tg<{ url: string; pending_update_count: number; last_error_message?: string }>("getWebhookInfo");
console.log(`Webhook activo: ${info.url}`);
console.log(`Pendientes: ${info.pending_update_count}`);
if (info.last_error_message) console.log(`Último error: ${info.last_error_message}`);
