// Postgres de Supabase: solo estado técnico (updates, sesiones, álbumes, reintentos, errores).

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.118.0";
import { env, supabaseSecretKey } from "./env.ts";

let client: SupabaseClient | null = null;

function db(): SupabaseClient {
  client ??= createClient(env("SUPABASE_URL"), supabaseSecretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

const SESSION_TTL_MS = 2 * 60 * 60 * 1000;

/** Registra el update. Devuelve false si ya se había procesado (Telegram reintenta). */
export async function isNewUpdate(updateId: number): Promise<boolean> {
  const { data, error } = await db()
    .from("updates_procesados")
    .upsert({ update_id: updateId }, { onConflict: "update_id", ignoreDuplicates: true })
    .select("update_id");
  if (error) throw new Error(`updates_procesados: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

// --- Sesiones ----------------------------------------------------------------

/** Fila de la tabla sesiones (las columnas se llaman como en el prompt). */
export interface Session<D = Record<string, unknown>> {
  chat_id: number;
  user_id: number;
  flujo: string;
  paso: string;
  datos: D;
  actualizado_en: string;
}

export async function readSession<D = Record<string, unknown>>(
  chatId: number,
  userId: number,
): Promise<Session<D> | null> {
  const { data, error } = await db()
    .from("sesiones")
    .select("*")
    .eq("chat_id", chatId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`sesiones: ${error.message}`);
  if (!data) return null;
  if (Date.now() - new Date(data.actualizado_en).getTime() > SESSION_TTL_MS) {
    await deleteSession(chatId, userId);
    return null;
  }
  return data as Session<D>;
}

export async function saveSession(
  chatId: number,
  userId: number,
  flow: string,
  step: string,
  data: Record<string, unknown>,
): Promise<void> {
  const { error } = await db().from("sesiones").upsert({
    chat_id: chatId,
    user_id: userId,
    flujo: flow,
    paso: step,
    datos: data,
    actualizado_en: new Date().toISOString(),
  });
  if (error) throw new Error(`sesiones: ${error.message}`);
}

export async function deleteSession(chatId: number, userId: number): Promise<void> {
  const { error } = await db().from("sesiones").delete().eq("chat_id", chatId).eq("user_id", userId);
  if (error) throw new Error(`sesiones: ${error.message}`);
}

/** Pasa la sesión de `from` a `to` solo si sigue en `from`. Evita guardar dos veces con un doble toque. */
export async function claimStep(chatId: number, userId: number, from: string, to: string): Promise<boolean> {
  const { data, error } = await db()
    .from("sesiones")
    .update({ paso: to, actualizado_en: new Date().toISOString() })
    .eq("chat_id", chatId)
    .eq("user_id", userId)
    .eq("paso", from)
    .select("paso");
  if (error) throw new Error(`sesiones: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

// --- Álbumes -----------------------------------------------------------------

export async function bufferAlbumUpdate(mediaGroupId: string, update: unknown): Promise<string> {
  const { data, error } = await db()
    .from("album_buffer")
    .insert({ media_group_id: mediaGroupId, update })
    .select("recibido_en")
    .single();
  if (error) throw new Error(`album_buffer: ${error.message}`);
  return data.recibido_en as string;
}

export async function latestAlbumUpdate(mediaGroupId: string): Promise<string | null> {
  const { data, error } = await db()
    .from("album_buffer")
    .select("recibido_en")
    .eq("media_group_id", mediaGroupId)
    .order("recibido_en", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`album_buffer: ${error.message}`);
  return (data?.recibido_en as string) ?? null;
}

/** Saca todos los updates del álbum de una vez. Solo un proceso los recibe. */
export async function takeAlbum(mediaGroupId: string): Promise<unknown[]> {
  const { data, error } = await db()
    .from("album_buffer")
    .delete()
    .eq("media_group_id", mediaGroupId)
    .select("update, recibido_en");
  if (error) throw new Error(`album_buffer: ${error.message}`);
  return (data ?? [])
    .sort((a, b) => String(a.recibido_en).localeCompare(String(b.recibido_en)))
    .map((r) => r.update);
}

// --- Cola de reintentos (Gemini sin cuota) -------------------------------------

export interface QueuedUpdate {
  id: number;
  update: unknown;
  intentos: number;
  proximo_intento: string;
}

const inMs = (ms: number) => new Date(Date.now() + ms).toISOString();

export async function enqueueRetry(payload: unknown, error: string, delayMs: number): Promise<void> {
  const { error: e } = await db()
    .from("cola_reintentos")
    .insert({ update: payload, intentos: 0, proximo_intento: inMs(delayMs), error });
  if (e) throw new Error(`cola_reintentos: ${e.message}`);
}

/** Toma los reintentos vencidos. Cada uno lo reclama un solo proceso (lo corre 10 min hacia adelante). */
export async function claimDueRetries(limit = 3): Promise<QueuedUpdate[]> {
  const { data, error } = await db()
    .from("cola_reintentos")
    .select("id, update, intentos, proximo_intento")
    .lte("proximo_intento", new Date().toISOString())
    .order("proximo_intento", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`cola_reintentos: ${error.message}`);
  const claimed: QueuedUpdate[] = [];
  for (const item of (data ?? []) as QueuedUpdate[]) {
    const { data: got, error: e } = await db()
      .from("cola_reintentos")
      .update({ proximo_intento: inMs(10 * 60_000) })
      .eq("id", item.id)
      .eq("proximo_intento", item.proximo_intento)
      .select("id");
    if (e) throw new Error(`cola_reintentos: ${e.message}`);
    if (got?.length) claimed.push(item);
  }
  return claimed;
}

export async function rescheduleRetry(id: number, attempts: number, delayMs: number, error: string): Promise<void> {
  const { error: e } = await db()
    .from("cola_reintentos")
    .update({ intentos: attempts, proximo_intento: inMs(delayMs), error })
    .eq("id", id);
  if (e) throw new Error(`cola_reintentos: ${e.message}`);
}

export async function deleteRetry(id: number): Promise<void> {
  const { error } = await db().from("cola_reintentos").delete().eq("id", id);
  if (error) throw new Error(`cola_reintentos: ${error.message}`);
}

// --- Errores -----------------------------------------------------------------

export async function logError(context: string, detail: string): Promise<void> {
  const { error } = await db().from("errores").insert({ contexto: context, detalle: detail });
  if (error) console.error("No pude guardar el error:", error.message);
}
