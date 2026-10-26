// Edge Function «programado»: la llama pg_cron. La lógica está en handler.ts y jobs.ts.
import { handler } from "./handler.ts";

Deno.serve(handler);
