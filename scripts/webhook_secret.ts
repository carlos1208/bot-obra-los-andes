// Genera secretos y los guarda en .env.local (no los muestra).
// Uso: deno task secreto                (TELEGRAM_WEBHOOK_SECRET)
//      deno task secreto-programado     (PROGRAMADO_SECRET, fase 6)
//      deno task secreto-correo         (GMAIL_SCRIPT_SECRET, facturas del correo)
//      deno task secreto-tablero        (TABLERO_TOKEN_CARLOS y TABLERO_TOKEN_HERMANO, enlaces del tablero)
import { saveToEnv } from "./_env.ts";

const NAMES = [
  "TELEGRAM_WEBHOOK_SECRET",
  "PROGRAMADO_SECRET",
  "GMAIL_SCRIPT_SECRET",
  "TABLERO_TOKEN_CARLOS",
  "TABLERO_TOKEN_HERMANO",
];
const names = Deno.args.length ? Deno.args : ["TELEGRAM_WEBHOOK_SECRET"];
const unknown = names.filter((n) => !NAMES.includes(n));
if (unknown.length) {
  console.error(`Solo genero ${NAMES.join(", ")}.`);
  Deno.exit(1);
}
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
for (const name of names) {
  const bytes = crypto.getRandomValues(new Uint8Array(48));
  const secret = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
  await saveToEnv(name, secret);
  console.log(`Listo: ${name} quedó guardado en .env.local.`);
}
