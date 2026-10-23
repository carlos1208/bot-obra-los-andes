// Genera TELEGRAM_WEBHOOK_SECRET y lo guarda en .env.local (no lo muestra).
// Uso: deno task secreto
import { saveToEnv } from "./_env.ts";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
const bytes = crypto.getRandomValues(new Uint8Array(48));
const secret = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
await saveToEnv("TELEGRAM_WEBHOOK_SECRET", secret);
console.log("Listo: TELEGRAM_WEBHOOK_SECRET quedó guardado en .env.local.");
