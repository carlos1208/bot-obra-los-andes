// Postgres de Supabase: solo estado técnico (updates, sesiones, álbumes, reintentos, errores).

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.118.0";
import { claveSupabase, env } from "./env.ts";

let cliente: SupabaseClient | null = null;

function db(): SupabaseClient {
  cliente ??= createClient(env("SUPABASE_URL"), claveSupabase(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cliente;
}

const DURACION_SESION_MS = 2 * 60 * 60 * 1000;

/** Registra el update. Devuelve false si ya se había procesado (Telegram reintenta). */
export async function esUpdateNuevo(updateId: number): Promise<boolean> {
  const { data, error } = await db()
    .from("updates_procesados")
    .upsert({ update_id: updateId }, { onConflict: "update_id", ignoreDuplicates: true })
    .select("update_id");
  if (error) throw new Error(`updates_procesados: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

// --- Sesiones ----------------------------------------------------------------

export interface Sesion<D = Record<string, unknown>> {
  chat_id: number;
  user_id: number;
  flujo: string;
  paso: string;
  datos: D;
  actualizado_en: string;
}

export async function leerSesion<D = Record<string, unknown>>(
  chatId: number,
  userId: number,
): Promise<Sesion<D> | null> {
  const { data, error } = await db()
    .from("sesiones")
    .select("*")
    .eq("chat_id", chatId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`sesiones: ${error.message}`);
  if (!data) return null;
  if (Date.now() - new Date(data.actualizado_en).getTime() > DURACION_SESION_MS) {
    await borrarSesion(chatId, userId);
    return null;
  }
  return data as Sesion<D>;
}

export async function guardarSesion(
  chatId: number,
  userId: number,
  flujo: string,
  paso: string,
  datos: Record<string, unknown>,
): Promise<void> {
  const { error } = await db().from("sesiones").upsert({
    chat_id: chatId,
    user_id: userId,
    flujo,
    paso,
    datos,
    actualizado_en: new Date().toISOString(),
  });
  if (error) throw new Error(`sesiones: ${error.message}`);
}

export async function borrarSesion(chatId: number, userId: number): Promise<void> {
  const { error } = await db().from("sesiones").delete().eq("chat_id", chatId).eq("user_id", userId);
  if (error) throw new Error(`sesiones: ${error.message}`);
}

// --- Álbumes -----------------------------------------------------------------

export async function guardarEnAlbum(mediaGroupId: string, update: unknown): Promise<string> {
  const { data, error } = await db()
    .from("album_buffer")
    .insert({ media_group_id: mediaGroupId, update })
    .select("recibido_en")
    .single();
  if (error) throw new Error(`album_buffer: ${error.message}`);
  return data.recibido_en as string;
}

export async function ultimoDelAlbum(mediaGroupId: string): Promise<string | null> {
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
export async function tomarAlbum(mediaGroupId: string): Promise<unknown[]> {
  const { data, error } = await db()
    .from("album_buffer")
    .delete()
    .eq("media_group_id", mediaGroupId)
    .select("update, recibido_en");
  if (error) throw new Error(`album_buffer: ${error.message}`);
  return (data ?? [])
    .sort((a, b) => String(a.recibido_en).localeCompare(String(b.recibido_en)))
    .map((f) => f.update);
}

// --- Errores -----------------------------------------------------------------

export async function registrarError(contexto: string, detalle: string): Promise<void> {
  const { error } = await db().from("errores").insert({ contexto, detalle });
  if (error) console.error("No pude guardar el error:", error.message);
}
