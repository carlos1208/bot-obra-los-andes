// Corre a mano un aviso programado en la función desplegada, como lo hace el cron, con la fecha simulada.
// Uso: deno task programado lunes --fecha 2026-11-02
//      deno task programado diario --fecha 2026-10-31     (un sábado: incluye el cierre de la semana)
// Sin --fecha usa el día de hoy. Ojo: escribe de verdad (manda los mensajes y marca aviso_enviado).
import { loadEnv, required } from "./_env.ts";

await loadEnv();
const projectRef = required("PROJECT_REF");
const secret = required("PROGRAMADO_SECRET");

const job = Deno.args[0];
const i = Deno.args.indexOf("--fecha");
const fecha = i >= 0 ? Deno.args[i + 1] : undefined;
if ((job !== "lunes" && job !== "diario") || (i >= 0 && !fecha)) {
  console.error("Uso: deno task programado lunes|diario [--fecha AAAA-MM-DD]");
  Deno.exit(1);
}

const r = await fetch(`https://${projectRef}.supabase.co/functions/v1/programado`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Programado-Secret": secret },
  body: JSON.stringify({ tarea: job, ...(fecha ? { fecha } : {}) }),
});
const data = await r.json().catch(() => ({})) as { fecha?: string; enviado?: string[]; error?: string };
if (!r.ok) {
  console.error(`La función respondió ${r.status}: ${data.error ?? r.statusText}`);
  if (r.status === 401) {
    console.error("Revisa que PROGRAMADO_SECRET sea igual en .env.local y en Supabase (deno task secretos).");
  }
  if (r.status === 404) console.error("¿Ya desplegaste la función? npx supabase functions deploy programado --use-api");
  Deno.exit(1);
}
console.log(`Aviso «${job}» del ${data.fecha}:`);
for (const line of data.enviado ?? []) console.log(`  • ${line}`);
