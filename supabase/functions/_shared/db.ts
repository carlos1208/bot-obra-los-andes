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

// --- Errores -----------------------------------------------------------------

export async function logError(context: string, detail: string): Promise<void> {
  const { error } = await db().from("errores").insert({ contexto: context, detalle: detail });
  if (error) console.error("No pude guardar el error:", error.message);
}
