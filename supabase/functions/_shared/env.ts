// Lectura de secretos. Nunca se registran ni se muestran.

export function env(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Falta el secreto ${name}`);
  return value;
}

export function envNumber(name: string): number {
  const n = Number(env(name));
  if (!Number.isFinite(n)) throw new Error(`El secreto ${name} no es un número`);
  return n;
}

/** Clave secreta de Supabase: la nueva (SUPABASE_SECRET_KEYS) o la heredada. */
export function supabaseSecretKey(): string {
  const keys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (keys) {
    const parsed = JSON.parse(keys) as Record<string, string>;
    if (parsed.default) return parsed.default;
  }
  return env("SUPABASE_SERVICE_ROLE_KEY");
}
