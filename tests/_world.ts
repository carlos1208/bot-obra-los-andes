// Mundo simulado para las pruebas de punta a punta: Telegram, Google (Sheets y Drive), Postgres (PostgREST)
// y Gemini. Cada archivo de prueba corre aislado, así que cada uno tiene su propio mundo.
import { parse } from "jsr:@std/csv@1.0.6";
import type { Update } from "../supabase/functions/_shared/telegram.ts";

export const CARLOS = 111;
export const BROTHER = 222;
export const GROUP = -100999;
export const REPORTS_TOPIC = 2;
export const PHOTOS_TOPIC = 3;
export const EXPENSES_TOPIC = 4;

const secrets: Record<string, string> = {
  TELEGRAM_BOT_TOKEN: "tok",
  CARLOS_TG_ID: String(CARLOS),
  HERMANO_TG_ID: String(BROTHER),
  GROUP_CHAT_ID: String(GROUP),
  TOPIC_REPORTES_ID: String(REPORTS_TOPIC),
  TOPIC_FOTOS_ID: String(PHOTOS_TOPIC),
  TOPIC_GASTOS_ID: String(EXPENSES_TOPIC),
  SHEET_ID: "hoja",
  GOOGLE_SA_EMAIL: "bot@prueba.iam.gserviceaccount.com",
  GOOGLE_OAUTH_CLIENT_ID: "cid",
  GOOGLE_OAUTH_CLIENT_SECRET: "csec",
  GOOGLE_OAUTH_REFRESH_TOKEN: "rt",
  DRIVE_ROOT_FOLDER_ID: "raiz",
  SUPABASE_URL: "https://proyecto.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "clave",
  GEMINI_API_KEY: "gem",
  GEMINI_MODEL: "modelo",
  GEMINI_MODEL_FALLBACK: "respaldo",
};
for (const [k, v] of Object.entries(secrets)) Deno.env.set(k, v);
const keyPair = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true,
  ["sign"],
);
const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", keyPair.privateKey));
Deno.env.set(
  "GOOGLE_SA_PRIVATE_KEY",
  `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der))}\n-----END PRIVATE KEY-----`,
);

// --- Estado ------------------------------------------------------------------------
type DbRow = Record<string, unknown>;
export const tables: Record<string, DbRow[]> = {};
export interface FakeFile {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  appProperties?: Record<string, string>;
  createdTime?: string;
  trashed?: boolean;
}
export const drive: FakeFile[] = [];
export const sent: { method: string; params: Record<string, unknown> }[] = [];
export const sheet: Record<string, unknown[][]> = {};
const TABS = [
  "Config",
  "Tareas",
  "Hitos",
  "Esperado",
  "Objetivos",
  "Reportes",
  "Notas",
  "Gastos",
  "Productos",
  "Pagos",
  "Presupuesto",
];
export async function resetSheet(): Promise<void> {
  for (const t of TABS) sheet[t] = parse(await Deno.readTextFile(new URL(`../semillas/${t}.csv`, import.meta.url)));
}
await resetSheet();

/** Consultas de append a Sheets (para revisar sus opciones). */
export const appends: string[] = [];
/** Pestañas cuyo próximo append falla con un 500 (una vez cada una). */
export const failAppend = new Set<string>();

/** Respuestas de Gemini en orden: un objeto (JSON de la respuesta) o { status } para un error HTTP. */
export const gemini = {
  replies: [] as unknown[],
  calls: [] as { model: string; body: any }[],
};

// --- PostgREST -------------------------------------------------------------------
let nextId = 1;
function filters(url: URL): ((r: DbRow) => boolean)[] {
  return [...url.searchParams].flatMap(([k, v]) => {
    if (v.startsWith("eq.")) return [(r: DbRow) => String(r[k]) === v.slice(3)];
    if (v.startsWith("lte.")) return [(r: DbRow) => String(r[k]) <= v.slice(4)];
    return [];
  });
}

function postgrest(url: URL, init: RequestInit): Response {
  const table = url.pathname.split("/").pop()!;
  const rows = (tables[table] ??= []);
  const fs = filters(url);
  const matches = (r: DbRow) => fs.every((f) => f(r));
  const headers = new Headers(init.headers);
  const prefer = headers.get("Prefer") ?? "";
  const single = (headers.get("Accept") ?? "").includes("vnd.pgrst.object");
  const respond = (data: DbRow[]) => single ? Response.json(data[0] ?? null) : Response.json(data, { status: 200 });
  const method = init.method ?? "GET";

  if (method === "GET") {
    let out = rows.filter(matches);
    const order = url.searchParams.get("order");
    if (order) {
      const [column, dir] = order.split(".");
      out = [...out].sort((a, b) => String(a[column]).localeCompare(String(b[column])) * (dir === "desc" ? -1 : 1));
    }
    const limit = url.searchParams.get("limit");
    return respond(limit ? out.slice(0, Number(limit)) : out);
  }
  if (method === "DELETE") {
    const deleted = rows.filter(matches);
    tables[table] = rows.filter((r) => !matches(r));
    return prefer.includes("return=representation") ? respond(deleted) : new Response(null, { status: 204 });
  }
  const body = JSON.parse(String(init.body));
  if (method === "PATCH") {
    const changed = rows.filter(matches);
    for (const r of changed) Object.assign(r, body);
    return prefer.includes("return=representation") ? respond(changed) : new Response(null, { status: 204 });
  }
  // POST (insert / upsert)
  const inserted: DbRow[] = [];
  for (const r of Array.isArray(body) ? body : [body]) {
    const key = table === "updates_procesados" ? ["update_id"] : table === "sesiones" ? ["chat_id", "user_id"] : [];
    const previous = key.length ? rows.find((x) => key.every((k) => x[k] === r[k])) : undefined;
    if (previous && prefer.includes("ignore-duplicates")) continue;
    if (previous) Object.assign(previous, r);
    else {
      const stored = { id: nextId++, ...r, recibido_en: r.recibido_en ?? new Date().toISOString() };
      rows.push(stored);
      inserted.push(stored);
    }
  }
  return prefer.includes("return=representation") ? respond(inserted) : new Response(null, { status: 201 });
}

// --- Sheets ----------------------------------------------------------------------
const letterIndex = (letters: string) => [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
/** USER_ENTERED quita la comilla de los textos. */
const entered = (v: unknown) => typeof v === "string" && v.startsWith("'") ? v.slice(1) : v;

function sheets(url: URL, init: RequestInit): Response {
  const path = decodeURIComponent(url.pathname);
  if (path.endsWith("/values:batchGet")) {
    const ranges = url.searchParams.getAll("ranges").map((r) => r.replaceAll("'", ""));
    return Response.json({ valueRanges: ranges.map((r) => ({ values: sheet[r] ?? [] })) });
  }
  if (path.endsWith("/values:batchUpdate")) {
    const body = JSON.parse(String(init.body));
    for (const d of body.data) {
      const [, tab, col, row] = d.range.match(/'([^']+)'!([A-Z]+)(\d+)/);
      const cells = (sheet[tab][Number(row) - 1] ??= []);
      cells[letterIndex(col)] = entered(d.values[0][0]);
    }
    return Response.json({});
  }
  const append = path.match(/\/values\/'([^']+)'!A1:append$/);
  if (append) {
    if (failAppend.delete(append[1])) return Response.json({ error: { message: "falla de prueba" } }, { status: 500 });
    appends.push(url.search);
    for (const row of JSON.parse(String(init.body)).values) sheet[append[1]].push(row.map(entered));
    return Response.json({});
  }
  const header = path.match(/\/values\/'([^']+)'!1:1$/);
  if (header) return Response.json({ values: [sheet[header[1]][0]] });
  throw new Error(`Sheets inesperado: ${path}`);
}

/** Filas de una pestaña como objetos (columna → valor). */
export function rowsOf(tab: string): Record<string, unknown>[] {
  const [head, ...rest] = sheet[tab];
  return rest.map((cells) => Object.fromEntries(head.map((h, i) => [String(h), cells[i] ?? ""])));
}

// --- Drive -----------------------------------------------------------------------
/** Hora de creación de los archivos: sigue al reloj simulado de las pruebas. */
let now = () => new Date();
function driveQuery(q: string): FakeFile[] {
  const name = q.match(/name = '([^']*)'/)?.[1];
  const parent = q.match(/'([^']+)' in parents/)?.[1];
  const mime = q.match(/mimeType = '([^']+)'/)?.[1];
  const prop = q.match(/appProperties has \{ key='(\w+)' and value='([^']*)' \}/);
  // Lo que está en la papelera (o dentro de una carpeta en la papelera) no aparece.
  const trashed = (f: FakeFile): boolean =>
    Boolean(f.trashed) || f.parents.some((id) => {
      const parentFile = drive.find((x) => x.id === id);
      return parentFile ? trashed(parentFile) : false;
    });
  return drive.filter((f) =>
    !trashed(f) && (!name || f.name === name) && (!parent || f.parents.includes(parent)) &&
    (!mime || f.mimeType === mime) && (!prop || f.appProperties?.[prop[1]] === prop[2])
  );
}

async function driveApi(url: URL, init: RequestInit): Promise<Response> {
  const method = init.method ?? "GET";
  if (url.pathname === "/drive/v3/files" && method === "GET") {
    return Response.json({ files: driveQuery(url.searchParams.get("q")!) });
  }
  const id = url.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/)?.[1];
  if (id && method === "GET") return new Response(new Uint8Array([4, 5, 6])); // alt=media
  if (id && method === "PATCH") {
    const file = drive.find((f) => f.id === id)!;
    const body = JSON.parse(String(init.body));
    if (body.trashed) file.trashed = true;
    for (const [k, v] of Object.entries(body.appProperties ?? {})) {
      file.appProperties ??= {};
      if (v === null) delete file.appProperties[k];
      else file.appProperties[k] = String(v);
    }
    return Response.json(file);
  }
  let meta: Omit<FakeFile, "id">;
  if (url.pathname.startsWith("/upload/")) {
    const text = await new Response(init.body as Blob).text();
    meta = JSON.parse(text.split("\r\n\r\n")[1].split("\r\n")[0]);
    meta.mimeType = [...text.matchAll(/Content-Type: ([\w/.+-]+)/g)][1][1];
  } else {
    meta = JSON.parse(String(init.body));
  }
  const file = {
    id: `d${drive.length + 1}`,
    ...meta,
    createdTime: now().toISOString(),
    webViewLink: `https://drive/${drive.length + 1}`,
  };
  drive.push(file as FakeFile);
  return Response.json(file);
}

// --- Telegram --------------------------------------------------------------------
let nextBotMessage = 5000;
/** Mensaje del bot con los botones más recientes: ahí «toca» tap(). */
export let keyboardMessage = 0;
/** Cuántas de las próximas llamadas a Telegram responden 429 (retry_after 0). */
export const telegramFlood = { times: 0 };
const hasKeyboard = (p: Record<string, unknown>) =>
  ((p.reply_markup as { inline_keyboard?: unknown[] } | undefined)?.inline_keyboard?.length ?? 0) > 0;

function telegram(url: URL, init: RequestInit): Response {
  if (url.pathname.startsWith("/file/")) return new Response(new Uint8Array([1, 2, 3]));
  const method = url.pathname.split("/").pop()!;
  // Las fotos van en multipart: se guardan los campos de texto y cuántos archivos llevaba.
  const params = init.body instanceof FormData
    ? {
      ...Object.fromEntries([...init.body].filter(([, v]) => typeof v === "string")),
      files: [...init.body].filter(([, v]) => typeof v !== "string").length,
    }
    : JSON.parse(String(init.body ?? "{}"));
  if (telegramFlood.times > 0) {
    // Telegram pide esperar: «Too Many Requests: retry after N».
    telegramFlood.times--;
    return Response.json(
      { ok: false, error_code: 429, description: "Too Many Requests: retry after 0", parameters: { retry_after: 0 } },
      { status: 429 },
    );
  }
  sent.push({ method, params });
  if (method === "getFile") return Response.json({ ok: true, result: { file_path: `files/${params.file_id}` } });
  if (method === "sendMessage") {
    const id = nextBotMessage++;
    if (hasKeyboard(params)) keyboardMessage = id;
    return Response.json({ ok: true, result: { message_id: id, chat: { id: params.chat_id } } });
  }
  if ((method === "editMessageText" || method === "editMessageReplyMarkup") && hasKeyboard(params)) {
    keyboardMessage = params.message_id;
  }
  return Response.json({ ok: true, result: true });
}

// --- Gemini ----------------------------------------------------------------------
function geminiApi(url: URL, init: RequestInit): Response {
  const model = decodeURIComponent(url.pathname.split("/").pop()!).split(":")[0];
  gemini.calls.push({ model, body: JSON.parse(String(init.body)) });
  const reply = gemini.replies.shift();
  if (reply === undefined) throw new Error("Gemini: no hay respuesta preparada");
  const status = (reply as { status?: number }).status;
  if (status) return Response.json({ error: { message: `error ${status}` } }, { status });
  return Response.json({
    candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] }, finishReason: "STOP" }],
  });
}

globalThis.fetch = async (input: string | URL | Request, init: RequestInit = {}) => {
  const url = new URL(String(input));
  switch (url.hostname) {
    case "oauth2.googleapis.com":
      return Response.json({ access_token: "t", expires_in: 3600 });
    case "proyecto.supabase.co":
      return postgrest(url, init);
    case "sheets.googleapis.com":
      return sheets(url, init);
    case "www.googleapis.com":
      return await driveApi(url, init);
    case "api.telegram.org":
      return telegram(url, init);
    case "generativelanguage.googleapis.com":
      return geminiApi(url, init);
  }
  throw new Error(`fetch inesperado: ${url}`);
};

export const { processUpdate, timing } = await import("../supabase/functions/telegram/process.ts");
export const { clock } = await import("../supabase/functions/_shared/format.ts");
now = () => clock.now();

// --- Ayudas ----------------------------------------------------------------------
const nameOf = (id: number) => id === CARLOS ? "Carlos" : id === BROTHER ? "Hermano" : "x";
let nextUpdate = 1000;
let nextMessage = 1;
export function message(from: number, extra: Record<string, unknown>, chat = from, topic?: number): Update {
  return {
    update_id: nextUpdate++,
    message: {
      message_id: nextMessage++,
      from: { id: from, first_name: nameOf(from) },
      chat: { id: chat, type: chat < 0 ? "supergroup" : "private" },
      message_thread_id: topic,
      date: 0,
      ...extra,
    },
  } as Update;
}
export function tap(from: number, data: string, chat = from, topic?: number, messageId = keyboardMessage): Update {
  return {
    update_id: nextUpdate++,
    callback_query: {
      id: `cb${nextUpdate}`,
      from: { id: from, first_name: nameOf(from) },
      data,
      message: {
        message_id: messageId,
        chat: { id: chat, type: chat < 0 ? "supergroup" : "private" },
        message_thread_id: topic,
        date: 0,
      },
    },
  } as Update;
}
export const photo = (id: string, caption?: string) => ({
  caption,
  photo: [
    { file_id: `${id}-s`, file_unique_id: id, width: 90, height: 90 },
    { file_id: id, file_unique_id: id, width: 1280, height: 960, file_size: 300_000 },
  ],
});
export const pdf = (id: string) => ({
  document: { file_id: id, file_unique_id: id, file_name: "factura.pdf", mime_type: "application/pdf" },
});
export const voice = (id: string) => ({
  voice: { file_id: id, file_unique_id: id, mime_type: "audio/ogg", duration: 9 },
});

const texts = () => sent.filter((e) => e.method === "sendMessage" || e.method === "editMessageText");
export const lastText = () => String(texts().at(-1)?.params.text ?? "");
/** Último mensaje mandado a un chat (y tema). */
export const lastTo = (chat: number, topic?: number) =>
  String(
    [...sent].reverse().find((e) =>
      e.method === "sendMessage" && e.params.chat_id === chat &&
      (topic === undefined || e.params.message_thread_id === topic)
    )?.params.text ?? "",
  );
export const clearSent = () => (sent.length = 0);
/** Botones del mensaje activo. */
export function buttons(): string[] {
  const e = [...sent].reverse().find((x) =>
    hasKeyboard(x.params) && (x.params.message_id === keyboardMessage || x.method === "sendMessage")
  );
  const kb = (e?.params.reply_markup as { inline_keyboard: { text: string; callback_data: string }[][] })
    ?.inline_keyboard ?? [];
  return kb.flat().map((b) => `${b.text}|${b.callback_data}`);
}
