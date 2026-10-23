// Genera TELEGRAM_WEBHOOK_SECRET y lo guarda en .env.local (no lo muestra).
// Uso: deno task secreto
import { guardarEnEnv } from "./_env.ts";

const alfabeto = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
const bytes = crypto.getRandomValues(new Uint8Array(48));
const secreto = Array.from(bytes, (b) => alfabeto[b % alfabeto.length]).join("");
await guardarEnEnv("TELEGRAM_WEBHOOK_SECRET", secreto);
console.log("Listo: TELEGRAM_WEBHOOK_SECRET quedó guardado en .env.local.");
