// Muestra los ids que van en .env.local: usuarios, grupo y temas.
// Antes de correrlo: tú y tu hermano escriben algo en cada tema del grupo,
// y tú le escribes /start al bot por privado.
// Uso: deno task ids            (si ya hay webhook: deno task ids --borrar-webhook)
import { loadEnv, required } from "./_env.ts";
import { type Message, tg, type Update } from "../supabase/functions/_shared/telegram.ts";

await loadEnv();
required("TELEGRAM_BOT_TOKEN");

const info = await tg<{ url: string }>("getWebhookInfo");
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

const me = await tg<{ username: string }>("getMe");
console.log(`Bot: @${me.username}\n`);

type FullMessage = Message & {
  from?: { id: number; is_bot?: boolean; first_name?: string; last_name?: string; username?: string };
};
const updates = await tg<Update[]>("getUpdates", { allowed_updates: ["message"] });
const users = new Map<number, string>();
const groups = new Map<number, string>();
const topics = new Map<string, { group: number; id: number; name: string }>();
const privateChats = new Set<number>();

for (const u of updates) {
  const m = u.message as FullMessage | undefined;
  if (!m) continue;
  if (m.from && !m.from.is_bot) {
    const name = `${m.from.first_name ?? ""} ${m.from.last_name ?? ""}`.trim();
    users.set(m.from.id, name + (m.from.username ? ` (@${m.from.username})` : ""));
  }
  if (m.chat.type === "private") privateChats.add(m.chat.id);
  if (m.chat.type === "supergroup") {
    groups.set(m.chat.id, `${m.chat.title}${m.chat.is_forum ? "" : "  ⚠️ sin temas activados"}`);
    const name = m.forum_topic_created?.name ?? m.reply_to_message?.forum_topic_created?.name;
    if (m.message_thread_id && name) {
      topics.set(`${m.chat.id}:${m.message_thread_id}`, { group: m.chat.id, id: m.message_thread_id, name });
    }
  }
}

if (!updates.length) {
  console.log("No hay mensajes nuevos. Escriban algo en cada tema y en el privado, y vuelve a correrlo.");
  Deno.exit(0);
}

console.log("Usuarios:");
for (const [id, name] of users) {
  console.log(`  ${id}  ${name}${privateChats.has(id) ? "  · escribió por privado" : ""}`);
}
console.log("\nGrupos:");
for (const [id, title] of groups) console.log(`  ${id}  ${title}`);
console.log("\nTemas:");
for (const t of topics.values()) console.log(`  ${t.id}  ${t.name}  (grupo ${t.group})`);

const norm = (s: string) => s.normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase().trim();
const topic = (n: string) => [...topics.values()].find((t) => norm(t.name) === n)?.id ?? "";
console.log("\nPara .env.local (revisa cuál usuario es tu hermano):");
console.log(`GROUP_CHAT_ID=${[...groups.keys()][0] ?? ""}`);
console.log(`TOPIC_REPORTES_ID=${topic("reportes")}`);
console.log(`TOPIC_FOTOS_ID=${topic("antes y despues")}`);
console.log(`TOPIC_GASTOS_ID=${topic("gastos")}`);
console.log("CARLOS_TG_ID=   ← tu id de la lista de usuarios");
console.log("HERMANO_TG_ID=  ← el id de tu hermano (déjalo vacío si todavía no está en el grupo)");
