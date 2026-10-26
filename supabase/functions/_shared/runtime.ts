// Ayudas de las Edge Functions: comparar secretos y seguir trabajando después de responder.

/** Compara en tiempo constante (para secretos de encabezados). */
export function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** Deja la tarea corriendo aunque ya se haya respondido (EdgeRuntime.waitUntil). */
export function runInBackground(task: Promise<unknown>): void {
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
  if (runtime) runtime.waitUntil(task);
  else task.catch((e) => console.error(e));
}
