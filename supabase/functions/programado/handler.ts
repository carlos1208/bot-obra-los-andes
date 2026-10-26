// Avisos programados: la petición que hace pg_cron (con pg_net) con el secreto en X-Programado-Secret.
// Cuerpo: {"tarea": "lunes"} o {"tarea": "diario"}. Para probar a mano, "fecha": "AAAA-MM-DD" simula ese día.
// Responde con lo que mandó; si quien llama deja de esperar, el trabajo sigue en segundo plano.

import { env } from "../_shared/env.ts";
import { clock, parseDateInput } from "../_shared/format.ts";
import { runInBackground, safeEqual } from "../_shared/runtime.ts";
import { type Job, runJob } from "./jobs.ts";

const JOBS: Job[] = ["lunes", "diario"];

export async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return new Response("ok");
  if (!safeEqual(req.headers.get("X-Programado-Secret") ?? "", env("PROGRAMADO_SECRET"))) {
    return new Response("no autorizado", { status: 401 });
  }
  const body = await req.json().catch(() => ({})) as { tarea?: string; fecha?: string };
  const job = JOBS.find((j) => j === body.tarea);
  if (!job) return Response.json({ error: "tarea debe ser «lunes» o «diario»" }, { status: 400 });
  if (body.fecha !== undefined) {
    // Fecha simulada, al mediodía de Bogotá.
    const iso = typeof body.fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.fecha)
      ? parseDateInput(body.fecha, body.fecha)
      : null;
    if (!iso) return Response.json({ error: "fecha debe ser AAAA-MM-DD" }, { status: 400 });
    clock.now = () => new Date(`${iso}T12:00:00-05:00`);
  } else {
    clock.now = () => new Date();
  }
  const task = runJob(job);
  runInBackground(task);
  try {
    return Response.json(await task);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
