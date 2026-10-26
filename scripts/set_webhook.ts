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
    { command: "reporte", description: "Reporte del día" },
    { command: "gasto", description: "Registrar una compra" },
    { command: "pago", description: "Registrar un pago o reposición de caja menor (Carlos)" },
    { command: "correo", description: "Facturas nuevas de tu correo (Carlos)" },
    { command: "estado", description: "Semana de obra, tareas de hoy y disponible" },
    { command: "antes", description: "Subir fotos ANTES" },
    { command: "despues", description: "Subir fotos DESPUÉS" },
    { command: "pendientes", description: "Pares por validar (Carlos)" },
    { command: "tablero", description: "Tu enlace a la página de la obra" },
  ],
});
const info = await tg<{ url: string; pending_update_count: number; last_error_message?: string }>("getWebhookInfo");
console.log(`Webhook activo: ${info.url}`);
console.log(`Pendientes: ${info.pending_update_count}`);
if (info.last_error_message) console.log(`Último error: ${info.last_error_message}`);
