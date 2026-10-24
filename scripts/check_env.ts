// Muestra qué valores de .env.example están llenos en .env.local, sin mostrarlos.
// Uso: deno task revisar
import { parse } from "jsr:@std/dotenv@0.225.8";
import { loadEnv } from "./_env.ts";

await loadEnv();
const keys = Object.keys(parse(await Deno.readTextFile(".env.example")));
// Puede esperar: el bot funciona sin el hermano.
const later = new Set(["HERMANO_TG_ID"]);
let missing = 0;
for (const k of keys) {
  const filled = Boolean(Deno.env.get(k));
  if (!filled && !later.has(k)) missing++;
  console.log(`${filled ? "✓" : later.has(k) ? "·" : "✗"} ${k}${filled ? "" : " (vacío)"}`);
}
console.log(missing ? `\nFaltan ${missing}.` : "\nTodo lo necesario está lleno.");
