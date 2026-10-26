// Edge Function «tablero»: la llama el Apps Script del tablero. La lógica está en handler.ts.
import { handler } from "./handler.ts";

Deno.serve(handler);
