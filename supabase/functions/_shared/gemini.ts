// Cliente mínimo de la API de Gemini (REST, models.generateContent) con salida JSON estructurada.
// Formato vigente (oct 2026): generationConfig.responseFormat.text = { mimeType: "APPLICATION_JSON", schema }.
// Los archivos van en línea (inline_data, base64).

import { env } from "./env.ts";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/** Límite del prompt: 20 MB en línea por solicitud (el mismo de los archivos de Telegram). */
export const MAX_INLINE_BYTES = 20 * 1024 * 1024;

export interface InlineFile {
  mimeType: string;
  bytes: Uint8Array;
}

export type Part = string | InlineFile;

/** Error de Gemini con el código HTTP. 429 = cuota agotada: va a la cola de reintentos. */
export class GeminiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "GeminiError";
  }
}

export const isQuotaError = (e: unknown): boolean => e instanceof GeminiError && e.status === 429;

export function primaryModel(): string {
  return env("GEMINI_MODEL");
}

export function fallbackModel(): string {
  return env("GEMINI_MODEL_FALLBACK");
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

interface Candidate {
  content?: { parts?: { text?: string; thought?: boolean }[] };
  finishReason?: string;
}

interface GenerateResponse {
  candidates?: Candidate[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string; status?: string };
}

/** Pide a Gemini una respuesta que cumpla el esquema JSON y la devuelve ya convertida. */
export async function generateJson<T>(opts: {
  instructions: string;
  parts: Part[];
  schema: Record<string, unknown>;
  model?: string;
}): Promise<T> {
  const model = opts.model ?? primaryModel();
  const inlineBytes = opts.parts.reduce((n, p) => n + (typeof p === "string" ? 0 : p.bytes.length), 0);
  if (inlineBytes > MAX_INLINE_BYTES) {
    throw new GeminiError(`El archivo pesa ${(inlineBytes / 1048576).toFixed(1)} MB; el límite es 20 MB`, 413);
  }
  const body = {
    systemInstruction: { parts: [{ text: opts.instructions }] },
    contents: [{
      role: "user",
      parts: opts.parts.map((p) =>
        typeof p === "string" ? { text: p } : { inline_data: { mime_type: p.mimeType, data: toBase64(p.bytes) } }
      ),
    }],
    generationConfig: {
      responseFormat: { text: { mimeType: "APPLICATION_JSON", schema: opts.schema } },
    },
  };
  const r = await fetch(`${BASE}/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": env("GEMINI_API_KEY"), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({})) as GenerateResponse;
  if (!r.ok) {
    throw new GeminiError(`Gemini ${model} ${r.status}: ${data.error?.message ?? r.statusText}`, r.status);
  }
  if (data.promptFeedback?.blockReason) {
    throw new GeminiError(`Gemini ${model} bloqueó la entrada: ${data.promptFeedback.blockReason}`, 422);
  }
  const candidate = data.candidates?.[0];
  if (candidate?.finishReason && candidate.finishReason !== "STOP") {
    throw new GeminiError(`Gemini ${model} no terminó la respuesta: ${candidate.finishReason}`, 422);
  }
  const text = (candidate?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("");
  if (!text) throw new GeminiError(`Gemini ${model} respondió vacío`, 502);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new GeminiError(`Gemini ${model} no devolvió JSON válido`, 502);
  }
}
