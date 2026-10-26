// Genera un secreto y lo guarda en .env.local (no lo muestra).
// Uso: deno task secreto                (TELEGRAM_WEBHOOK_SECRET)
//      deno task secreto-programado     (PROGRAMADO_SECRET, fase 6)
import { saveToEnv } from "./_env.ts";

const NAMES = ["TELEGRAM_WEBHOOK_SECRET", "PROGRAMADO_SECRET"];
const name = Deno.args[0] ?? "TELEGRAM_WEBHOOK_SECRET";
if (!NAMES.includes(name)) {
  console.error(`Solo genero ${NAMES.join(" o ")}.`);
  Deno.exit(1);
}
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
const bytes = crypto.getRandomValues(new Uint8Array(48));
const secret = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
await saveToEnv(name, secret);
console.log(`Listo: ${name} quedó guardado en .env.local.`);
