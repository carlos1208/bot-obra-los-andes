// Muestra los ids que van en .env.local: usuarios, grupo y temas.
// Antes de correrlo: tú y tu hermano escriben algo en cada tema del grupo,
// y tú le escribes /start al bot por privado.
// Uso: deno task ids            (si ya hay webhook: deno task ids --borrar-webhook)
import { cargarEnv, requerido } from "./_env.ts";

await cargarEnv();
const token = requerido("TELEGRAM_BOT_TOKEN");

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

const info = await tg("getWebhookInfo");
if (info.url) {
  if (!Deno.args.includes("--borrar-webhook")) {
    console.error("El bot tiene un webhook activo y así no puedo leer los mensajes.");
    console.error("Corre: deno task ids --borrar-webhook   (luego vuelve a activarlo con deno task webhook)");
    Deno.exit(1);
  }
  await tg("deleteWebhook");
  console.log("Webhook borrado. Escriban de nuevo en los temas y vuelve a correr deno task ids.");
  Deno.exit(0);
}

const yo = await tg("getMe");
console.log(`Bot: @${yo.username}\n`);

const updates = await tg("getUpdates", { allowed_updates: ["message"] });
const usuarios = new Map<number, string>();
const grupos = new Map<number, string>();
const temas = new Map<string, { grupo: number; id: number; nombre: string }>();
const privados = new Set<number>();

for (const u of updates) {
  const m = u.message;
  if (!m) continue;
  if (m.from && !m.from.is_bot) {
    usuarios.set(
      m.from.id,
      `${m.from.first_name ?? ""} ${m.from.last_name ?? ""}`.trim() + (m.from.username ? ` (@${m.from.username})` : ""),
    );
  }
  if (m.chat.type === "private") privados.add(m.chat.id);
  if (m.chat.type === "supergroup") {
    grupos.set(m.chat.id, `${m.chat.title}${m.chat.is_forum ? "" : "  ⚠️ sin temas activados"}`);
    const nombre = m.forum_topic_created?.name ?? m.reply_to_message?.forum_topic_created?.name;
    if (m.message_thread_id && nombre) {
      temas.set(`${m.chat.id}:${m.message_thread_id}`, { grupo: m.chat.id, id: m.message_thread_id, nombre });
    }
  }
}

if (!updates.length) {
  console.log("No hay mensajes nuevos. Escriban algo en cada tema y en el privado, y vuelve a correrlo.");
  Deno.exit(0);
}

console.log("Usuarios:");
for (const [id, nombre] of usuarios) {
  console.log(`  ${id}  ${nombre}${privados.has(id) ? "  · escribió por privado" : ""}`);
}
console.log("\nGrupos:");
for (const [id, titulo] of grupos) console.log(`  ${id}  ${titulo}`);
console.log("\nTemas:");
for (const t of temas.values()) console.log(`  ${t.id}  ${t.nombre}  (grupo ${t.grupo})`);

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const tema = (n: string) => [...temas.values()].find((t) => norm(t.nombre) === n)?.id ?? "";
console.log("\nPara .env.local (revisa cuál usuario es tu hermano):");
console.log(`GROUP_CHAT_ID=${[...grupos.keys()][0] ?? ""}`);
console.log(`TOPIC_REPORTES_ID=${tema("reportes")}`);
console.log(`TOPIC_FOTOS_ID=${tema("antes y despues")}`);
console.log(`TOPIC_GASTOS_ID=${tema("gastos")}`);
console.log("CARLOS_TG_ID=   ← tu id de la lista de usuarios");
console.log("HERMANO_TG_ID=  ← el id de tu hermano");
