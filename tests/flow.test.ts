// Flujo completo con Telegram, Google y Postgres simulados: autorización, duplicados,
// /estado en un tema y fotos ANTES (una por una y en álbum).
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.19";
import { parse } from "jsr:@std/csv@1.0.6";
import type { Update } from "../supabase/functions/_shared/telegram.ts";

const CARLOS = 111;
const BROTHER = 222;
const GROUP = -100999;
const REPORTS_TOPIC = 2;
const PHOTOS_TOPIC = 3;

const secrets: Record<string, string> = {
  TELEGRAM_BOT_TOKEN: "tok",
  CARLOS_TG_ID: String(CARLOS),
  HERMANO_TG_ID: String(BROTHER),
  GROUP_CHAT_ID: String(GROUP),
  TOPIC_REPORTES_ID: String(REPORTS_TOPIC),
  TOPIC_FOTOS_ID: String(PHOTOS_TOPIC),
  TOPIC_GASTOS_ID: "4",
  SHEET_ID: "hoja",
  GOOGLE_SA_EMAIL: "bot@prueba.iam.gserviceaccount.com",
  GOOGLE_OAUTH_CLIENT_ID: "cid",
  GOOGLE_OAUTH_CLIENT_SECRET: "csec",
  GOOGLE_OAUTH_REFRESH_TOKEN: "rt",
  DRIVE_ROOT_FOLDER_ID: "raiz",
  SUPABASE_URL: "https://proyecto.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "clave",
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

// --- Mundo simulado ------------------------------------------------------------
type DbRow = Record<string, unknown>;
const tables: Record<string, DbRow[]> = {};
interface FakeFile {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  appProperties?: Record<string, string>;
}
const drive: FakeFile[] = [];
const sent: { method: string; params: Record<string, unknown> }[] = [];
const sheet: Record<string, string[][]> = {};
for (const t of ["Config", "Tareas", "Gastos", "Pagos"]) {
  sheet[t] = parse(await Deno.readTextFile(new URL(`../semillas/${t}.csv`, import.meta.url)));
}

function eqFilters(url: URL): [string, string][] {
  return [...url.searchParams].filter(([, v]) => v.startsWith("eq.")).map(([k, v]) => [k, v.slice(3)]);
}

function postgrest(url: URL, init: RequestInit): Response {
  const table = url.pathname.split("/").pop()!;
  const rows = (tables[table] ??= []);
  const matches = (r: DbRow) => eqFilters(url).every(([k, v]) => String(r[k]) === v);
  const prefer = new Headers(init.headers).get("Prefer") ?? "";
  const single = (new Headers(init.headers).get("Accept") ?? "").includes("vnd.pgrst.object");
  const respond = (data: DbRow[]) => single ? Response.json(data[0] ?? null) : Response.json(data, { status: 200 });

  if (init.method === "GET" || !init.method) {
    let out = rows.filter(matches);
    const order = url.searchParams.get("order");
    if (order) {
      const [column, dir] = order.split(".");
      out = [...out].sort((a, b) => String(a[column]).localeCompare(String(b[column])) * (dir === "desc" ? -1 : 1));
    }
    const limit = url.searchParams.get("limit");
    return respond(limit ? out.slice(0, Number(limit)) : out);
  }
  if (init.method === "DELETE") {
    const deleted = rows.filter(matches);
    tables[table] = rows.filter((r) => !matches(r));
    return prefer.includes("return=representation") ? respond(deleted) : new Response(null, { status: 204 });
  }
  // POST (insert / upsert)
  const body = JSON.parse(String(init.body));
  const inserted: DbRow[] = [];
  for (const r of Array.isArray(body) ? body : [body]) {
    const key = table === "updates_procesados" ? ["update_id"] : table === "sesiones" ? ["chat_id", "user_id"] : [];
    const previous = key.length ? rows.find((x) => key.every((k) => x[k] === r[k])) : undefined;
    if (previous && prefer.includes("ignore-duplicates")) continue;
    if (previous) Object.assign(previous, r);
    else {
      const stored = { ...r, recibido_en: r.recibido_en ?? new Date().toISOString() };
      rows.push(stored);
      inserted.push(stored);
    }
  }
  return prefer.includes("return=representation") ? respond(inserted) : new Response(null, { status: 201 });
}

function driveQuery(q: string): FakeFile[] {
  const name = q.match(/name = '([^']*)'/)?.[1];
  const parent = q.match(/'([^']+)' in parents/)?.[1];
  const mime = q.match(/mimeType = '([^']+)'/)?.[1];
  const prop = q.match(/appProperties has \{ key='(\w+)' and value='([^']*)' \}/);
  return drive.filter((f) =>
    (!name || f.name === name) && (!parent || f.parents.includes(parent)) && (!mime || f.mimeType === mime) &&
    (!prop || f.appProperties?.[prop[1]] === prop[2])
  );
}

globalThis.fetch = async (input: string | URL | Request, init: RequestInit = {}) => {
  const url = new URL(String(input));
  if (url.hostname === "oauth2.googleapis.com") return Response.json({ access_token: "t", expires_in: 3600 });
  if (url.hostname === "proyecto.supabase.co") return postgrest(url, init);
  if (url.hostname === "sheets.googleapis.com") {
    const ranges = url.searchParams.getAll("ranges").map((r) => r.replaceAll("'", ""));
    return Response.json({ valueRanges: ranges.map((r) => ({ values: sheet[r] ?? [] })) });
  }
  if (url.hostname === "api.telegram.org") {
    if (url.pathname.startsWith("/file/")) return new Response(new Uint8Array([0xff, 0xd8, 0xff]));
    const method = url.pathname.split("/").pop()!;
    const params = JSON.parse(String(init.body ?? "{}"));
    sent.push({ method, params });
    if (method === "getFile") return Response.json({ ok: true, result: { file_path: `photos/${params.file_id}.jpg` } });
    return Response.json({ ok: true, result: { message_id: sent.length, chat: { id: params.chat_id } } });
  }
  if (url.hostname === "www.googleapis.com") {
    if (url.pathname === "/drive/v3/files" && (init.method ?? "GET") === "GET") {
      return Response.json({ files: driveQuery(url.searchParams.get("q")!) });
    }
    let meta: Omit<FakeFile, "id">;
    if (url.pathname.startsWith("/upload/")) {
      const text = await new Response(init.body as Blob).text();
      meta = JSON.parse(text.split("\r\n\r\n")[1].split("\r\n")[0]);
      meta.mimeType = text.match(/Content-Type: (image\/\w+)/)![1];
    } else {
      meta = JSON.parse(String(init.body));
    }
    const file = { id: `d${drive.length + 1}`, ...meta, webViewLink: `https://drive/${drive.length + 1}` };
    drive.push(file as FakeFile);
    return Response.json(file);
  }
  throw new Error(`fetch inesperado: ${url}`);
};

const { processUpdate } = await import("../supabase/functions/telegram/process.ts");

// --- Ayudas ----------------------------------------------------------------------
let nextUpdate = 1000;
let nextMessage = 1;
function message(from: number, extra: Record<string, unknown>, chat = from, topic?: number): Update {
  return {
    update_id: nextUpdate++,
    message: {
      message_id: nextMessage++,
      from: { id: from, first_name: "x" },
      chat: { id: chat, type: chat < 0 ? "supergroup" : "private" },
      message_thread_id: topic,
      date: 0,
      ...extra,
    },
  } as Update;
}
function tap(from: number, data: string, chat = from, topic?: number): Update {
  return {
    update_id: nextUpdate++,
    callback_query: {
      id: `cb${nextUpdate}`,
      from: { id: from, first_name: "x" },
      data,
      message: {
        message_id: 1,
        chat: { id: chat, type: chat < 0 ? "supergroup" : "private" },
        message_thread_id: topic,
        date: 0,
      },
    },
  } as Update;
}
const photo = (id: string) => ({
  photo: [
    { file_id: `${id}-s`, file_unique_id: id, width: 90, height: 90 },
    { file_id: id, file_unique_id: id, width: 1280, height: 960, file_size: 300_000 },
  ],
});
const lastText = () => String([...sent].reverse().find((e) => e.method === "sendMessage")?.params.text ?? "");
const clearSent = () => (sent.length = 0);

// --- Pruebas ----------------------------------------------------------------------
Deno.test("ignora a desconocidos sin responder ni guardar nada", async () => {
  clearSent();
  await processUpdate(message(333, { text: "/estado" }));
  await processUpdate(message(CARLOS, { text: "/estado" }, -100123)); // otro grupo
  assertEquals(sent.length, 0);
  assertEquals((tables.updates_procesados ?? []).length, 1); // solo el de Carlos en otro grupo pasó el filtro de remitente
});

Deno.test("update repetido se procesa una sola vez", async () => {
  clearSent();
  const u = message(CARLOS, { text: "/estado" });
  await processUpdate(u);
  await processUpdate(u);
  assertEquals(sent.filter((e) => e.method === "sendMessage").length, 1);
});

Deno.test("/estado en el tema Reportes responde en el mismo tema y sin dinero", async () => {
  clearSent();
  await processUpdate(message(BROTHER, { text: "/estado@ObraBot" }, GROUP, REPORTS_TOPIC));
  const reply = sent.find((e) => e.method === "sendMessage")!;
  assertEquals(reply.params.chat_id, GROUP);
  assertEquals(reply.params.message_thread_id, REPORTS_TOPIC);
  assertStringIncludes(String(reply.params.text), "ESTADO");
  assert(!String(reply.params.text).includes("12 M"));
});

Deno.test("fotos ANTES: catálogo, una por una y «Listo»", async () => {
  clearSent();
  await processUpdate(message(CARLOS, { text: "/antes" }, GROUP, PHOTOS_TOPIC));
  const catalog = sent.find((e) => e.method === "sendMessage")!;
  assertStringIncludes(String(catalog.params.text), "Faltan 24 de 24.");
  const keyboard = (catalog.params.reply_markup as { inline_keyboard: { callback_data: string }[][] }).inline_keyboard;
  assertEquals(keyboard[0][0].callback_data, "ant:c:F01");
  assertEquals(keyboard.at(-2)![0].callback_data, "ant:p:1"); // página siguiente

  await processUpdate(tap(CARLOS, "ant:c:F01", GROUP, PHOTOS_TOPIC));
  assertStringIncludes(lastText(), "Mándame de 1 a 3 fotos.");

  await processUpdate(message(CARLOS, photo("a1"), GROUP, PHOTOS_TOPIC));
  assertStringIncludes(lastText(), "Guardé 1 foto de F01. Van 1 de 3.");
  await processUpdate(tap(CARLOS, "ant:fin", GROUP, PHOTOS_TOPIC));
  assertStringIncludes(lastText(), "Listo: F01 · Muro cocina–sala completo quedó con 1 foto ANTES.");

  const folder = drive.find((f) => f.name === "F01 Muro cocina–sala completo")!;
  assertEquals(folder.parents, [drive.find((f) => f.name === "Antes y después")!.id]);
  const file = drive.find((f) => f.parents.includes(folder.id))!;
  assertEquals(file.name.replace(/\d{4}-\d{2}-\d{2}/, "FECHA"), "ANTES FECHA (1).jpg");
  assertEquals(file.appProperties, {
    codigo: "F01",
    nombre: "Muro cocina–sala completo",
    tipo: "antes",
    tareas: "02,09",
    hitos: "H1,H2",
    subido_por: "carlos",
    estado: "sin después",
  });
  assertEquals((tables.sesiones ?? []).length, 0);

  // F01 ya no aparece en el catálogo.
  clearSent();
  await processUpdate(message(CARLOS, { text: "/antes" }));
  assertStringIncludes(lastText(), "Faltan 23 de 24.");
});

Deno.test("fotos ANTES: álbum que llega antes de elegir el código", async () => {
  // La prueba anterior dejó abierto el catálogo en el privado: «Cancelar» lo cierra.
  await processUpdate(tap(CARLOS, "ant:x"));
  assertEquals((tables.sesiones ?? []).length, 0);
  clearSent();
  const group = { media_group_id: "alb1" };
  await Promise.all([
    processUpdate(message(CARLOS, { ...photo("b1"), ...group })),
    processUpdate(message(CARLOS, { ...photo("b2"), ...group })),
  ]);
  assertStringIncludes(lastText(), "Recibí 2 fotos. ¿De cuál foto ANTES son?");
  assertEquals((tables.album_buffer ?? []).length, 0);

  await processUpdate(tap(CARLOS, "ant:c:F09"));
  const folder = drive.find((f) => f.name === "F09 Techo de la cocina y del área de labores")!;
  const names = drive.filter((f) => f.parents.includes(folder.id)).map((f) => f.name.replace(/\d{4}-\d{2}-\d{2}/, "F"));
  assertEquals(names, ["ANTES F (1).jpg", "ANTES F (2).jpg"]);
  // F09 no tiene hitos: la propiedad no se guarda vacía.
  assertEquals("hitos" in drive.find((f) => f.parents.includes(folder.id))!.appProperties!, false);
  assertStringIncludes(lastText(), "Van 2 de 3");
  // La tercera cierra sola.
  await processUpdate(message(CARLOS, photo("b3")));
  assertStringIncludes(lastText(), "quedó con 3 fotos ANTES");
});

Deno.test("el hermano no sube ANTES y un error no le muestra detalles técnicos", async () => {
  clearSent();
  await processUpdate(message(BROTHER, { text: "/antes" }, GROUP, PHOTOS_TOPIC));
  assertStringIncludes(lastText(), "Las fotos ANTES las sube Carlos.");

  clearSent();
  const errorsBefore = (tables.errores ?? []).length;
  const saved = sheet.Config;
  sheet.Config = [["clave", "valor"]]; // Config rota: falta fecha_inicio
  await processUpdate(message(BROTHER, { text: "/estado" }, GROUP, REPORTS_TOPIC));
  sheet.Config = saved;
  const toBrother = sent.find((e) => e.params.chat_id === GROUP)!;
  assertEquals(toBrother.params.text, "No pude procesar eso. Ya le avisé a Carlos.");
  const toCarlos = sent.find((e) => e.params.chat_id === CARLOS)!;
  assertStringIncludes(String(toCarlos.params.text), "⚠️ Error");
  assertStringIncludes(String(toCarlos.params.text), "fecha_inicio");
  assertEquals(tables.errores.length, errorsBefore + 1);
});
