// Lectura de secretos. Nunca se registran ni se muestran.

export function env(nombre: string): string {
  const valor = Deno.env.get(nombre);
  if (!valor) throw new Error(`Falta el secreto ${nombre}`);
  return valor;
}

export function envNumero(nombre: string): number {
  const n = Number(env(nombre));
  if (!Number.isFinite(n)) throw new Error(`El secreto ${nombre} no es un número`);
  return n;
}

/** Clave secreta de Supabase: la nueva (SUPABASE_SECRET_KEYS) o la heredada. */
export function claveSupabase(): string {
  const nuevas = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (nuevas) {
    const claves = JSON.parse(nuevas) as Record<string, string>;
    if (claves.default) return claves.default;
  }
  return env("SUPABASE_SERVICE_ROLE_KEY");
}
