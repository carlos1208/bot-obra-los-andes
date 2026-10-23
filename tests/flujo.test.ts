// Flujo completo con Telegram, Google y Postgres simulados: autorización, duplicados,
// /estado en un tema y fotos ANTES (una por una y en álbum).
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.19";
import { parse } from "jsr:@std/csv@1.0.6";

const CARLOS = 111;
const HERMANO = 222;
const GRUPO = -100999;
const TEMA_REPORTES = 2;
const TEMA_FOTOS = 3;

const secretos: Record<string, string> = {
  TELEGRAM_BOT_TOKEN: "tok",
  CARLOS_TG_ID: String(CARLOS),
  HERMANO_TG_ID: String(HERMANO),
  GROUP_CHAT_ID: String(GRUPO),
  TOPIC_REPORTES_ID: String(TEMA_REPORTES),
  TOPIC_FOTOS_ID: String(TEMA_FOTOS),
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
for (const [k, v] of Object.entries(secretos)) Deno.env.set(k, v);
const par = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true,
  ["sign"],
);
const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", par.privateKey));
Deno.env.set(
  "GOOGLE_SA_PRIVATE_KEY",
  `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der))}\n-----END PRIVATE KEY-----`,
);

// --- Mundo simulado ------------------------------------------------------------
type FilaDb = Record<string, unknown>;
const tablas: Record<string, FilaDb[]> = {};
interface ArchivoSim {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  appProperties?: Record<string, string>;
}
const drive: ArchivoSim[] = [];
const enviados: { metodo: string; params: Record<string, unknown> }[] = [];
const hoja: Record<string, string[][]> = {};
for (const p of ["Config", "Tareas", "Gastos", "Pagos"]) {
  hoja[p] = parse(await Deno.readTextFile(new URL(`../semillas/${p}.csv`, import.meta.url)));
}

function filtrosEq(url: URL): [string, string][] {
  return [...url.searchParams].filter(([, v]) => v.startsWith("eq.")).map(([k, v]) => [k, v.slice(3)]);
}

function postgrest(url: URL, init: RequestInit): Response {
  const tabla = url.pathname.split("/").pop()!;
  const filas = (tablas[tabla] ??= []);
  const coincide = (f: FilaDb) => filtrosEq(url).every(([k, v]) => String(f[k]) === v);
  const prefer = new Headers(init.headers).get("Prefer") ?? "";
  const objeto = (new Headers(init.headers).get("Accept") ?? "").includes("vnd.pgrst.object");
  const responder = (datos: FilaDb[]) =>
    objeto ? Response.json(datos[0] ?? null) : Response.json(datos, { status: 200 });

  if (init.method === "GET" || !init.method) {
    let salida = filas.filter(coincide);
    const orden = url.searchParams.get("order");
    if (orden) {
      const [col, dir] = orden.split(".");
      salida = [...salida].sort((a, b) => String(a[col]).localeCompare(String(b[col])) * (dir === "desc" ? -1 : 1));
    }
    const limite = url.searchParams.get("limit");
    return responder(limite ? salida.slice(0, Number(limite)) : salida);
  }
  if (init.method === "DELETE") {
    const borradas = filas.filter(coincide);
    tablas[tabla] = filas.filter((f) => !coincide(f));
    return prefer.includes("return=representation") ? responder(borradas) : new Response(null, { status: 204 });
  }
  // POST (insert / upsert)
  const cuerpo = JSON.parse(String(init.body));
  const nuevas: FilaDb[] = [];
  for (const fila of Array.isArray(cuerpo) ? cuerpo : [cuerpo]) {
    const clave = tabla === "updates_procesados" ? ["update_id"] : tabla === "sesiones" ? ["chat_id", "user_id"] : [];
    const previa = clave.length ? filas.find((f) => clave.every((k) => f[k] === fila[k])) : undefined;
    if (previa && prefer.includes("ignore-duplicates")) continue;
    if (previa) Object.assign(previa, fila);
    else {
      const f = { ...fila, recibido_en: fila.recibido_en ?? new Date().toISOString() };
      filas.push(f);
      nuevas.push(f);
    }
  }
  return prefer.includes("return=representation") ? responder(nuevas) : new Response(null, { status: 201 });
}

function consultaDrive(q: string): ArchivoSim[] {
  const nombre = q.match(/name = '([^']*)'/)?.[1];
  const padre = q.match(/'([^']+)' in parents/)?.[1];
  const mime = q.match(/mimeType = '([^']+)'/)?.[1];
  const prop = q.match(/appProperties has \{ key='(\w+)' and value='([^']*)' \}/);
  return drive.filter((a) =>
    (!nombre || a.name === nombre) && (!padre || a.parents.includes(padre)) && (!mime || a.mimeType === mime) &&
    (!prop || a.appProperties?.[prop[1]] === prop[2])
  );
}

globalThis.fetch = async (entrada: string | URL | Request, init: RequestInit = {}) => {
  const url = new URL(String(entrada));
  if (url.hostname === "oauth2.googleapis.com") return Response.json({ access_token: "t", expires_in: 3600 });
  if (url.hostname === "proyecto.supabase.co") return postgrest(url, init);
  if (url.hostname === "sheets.googleapis.com") {
    const rangos = url.searchParams.getAll("ranges").map((r) => r.replaceAll("'", ""));
    return Response.json({ valueRanges: rangos.map((r) => ({ values: hoja[r] ?? [] })) });
  }
  if (url.hostname === "api.telegram.org") {
    if (url.pathname.startsWith("/file/")) return new Response(new Uint8Array([0xff, 0xd8, 0xff]));
    const metodo = url.pathname.split("/").pop()!;
    const params = JSON.parse(String(init.body ?? "{}"));
    enviados.push({ metodo, params });
    if (metodo === "getFile") return Response.json({ ok: true, result: { file_path: `photos/${params.file_id}.jpg` } });
    return Response.json({ ok: true, result: { message_id: enviados.length, chat: { id: params.chat_id } } });
  }
  if (url.hostname === "www.googleapis.com") {
    if (url.pathname === "/drive/v3/files" && (init.method ?? "GET") === "GET") {
      return Response.json({ files: consultaDrive(url.searchParams.get("q")!) });
    }
    let meta: Omit<ArchivoSim, "id">;
    if (url.pathname.startsWith("/upload/")) {
      const texto = await new Response(init.body as Blob).text();
      meta = JSON.parse(texto.split("\r\n\r\n")[1].split("\r\n")[0]);
      meta.mimeType = texto.match(/Content-Type: (image\/\w+)/)![1];
    } else {
      meta = JSON.parse(String(init.body));
    }
    const archivo = { id: `d${drive.length + 1}`, ...meta, webViewLink: `https://drive/${drive.length + 1}` };
    drive.push(archivo as ArchivoSim);
    return Response.json(archivo);
  }
  throw new Error(`fetch inesperado: ${url}`);
};

const { procesar } = await import("../supabase/functions/telegram/procesar.ts");
type Update = import("../supabase/functions/_shared/telegram.ts").Update;

// --- Ayudas ----------------------------------------------------------------------
let siguienteUpdate = 1000;
let siguienteMensaje = 1;
function mensaje(de: number, extra: Record<string, unknown>, chat = de, tema?: number): Update {
  return {
    update_id: siguienteUpdate++,
    message: {
      message_id: siguienteMensaje++,
      from: { id: de, first_name: "x" },
      chat: { id: chat, type: chat < 0 ? "supergroup" : "private" },
      message_thread_id: tema,
      date: 0,
      ...extra,
    },
  } as Update;
}
function toque(de: number, data: string, chat = de, tema?: number): Update {
  return {
    update_id: siguienteUpdate++,
    callback_query: {
      id: `cb${siguienteUpdate}`,
      from: { id: de, first_name: "x" },
      data,
      message: {
        message_id: 1,
        chat: { id: chat, type: chat < 0 ? "supergroup" : "private" },
        message_thread_id: tema,
        date: 0,
      },
    },
  } as Update;
}
const foto = (id: string) => ({
  photo: [{ file_id: `${id}-s`, file_unique_id: id, width: 90, height: 90 }, {
    file_id: id,
    file_unique_id: id,
    width: 1280,
    height: 960,
    file_size: 300_000,
  }],
});
const ultimoTexto = () => String([...enviados].reverse().find((e) => e.metodo === "sendMessage")?.params.text ?? "");
const limpiar = () => (enviados.length = 0);

// --- Pruebas ----------------------------------------------------------------------
Deno.test("ignora a desconocidos sin responder ni guardar nada", async () => {
  limpiar();
  await procesar(mensaje(333, { text: "/estado" }));
  await procesar(mensaje(CARLOS, { text: "/estado" }, -100123)); // otro grupo
  assertEquals(enviados.length, 0);
  assertEquals((tablas.updates_procesados ?? []).length, 1); // solo el de Carlos en otro grupo pasó el filtro de remitente
});

Deno.test("update repetido se procesa una sola vez", async () => {
  limpiar();
  const u = mensaje(CARLOS, { text: "/estado" });
  await procesar(u);
  await procesar(u);
  assertEquals(enviados.filter((e) => e.metodo === "sendMessage").length, 1);
});

Deno.test("/estado en el tema Reportes responde en el mismo tema y sin dinero", async () => {
  limpiar();
  await procesar(mensaje(HERMANO, { text: "/estado@ObraBot" }, GRUPO, TEMA_REPORTES));
  const envio = enviados.find((e) => e.metodo === "sendMessage")!;
  assertEquals(envio.params.chat_id, GRUPO);
  assertEquals(envio.params.message_thread_id, TEMA_REPORTES);
  assertStringIncludes(String(envio.params.text), "ESTADO");
  assert(!String(envio.params.text).includes("12 M"));
});

Deno.test("fotos ANTES: catálogo, una por una y «Listo»", async () => {
  limpiar();
  await procesar(mensaje(CARLOS, { text: "/antes" }, GRUPO, TEMA_FOTOS));
  const catalogo = enviados.find((e) => e.metodo === "sendMessage")!;
  assertStringIncludes(String(catalogo.params.text), "Faltan 24 de 24.");
  const teclado = (catalogo.params.reply_markup as { inline_keyboard: { callback_data: string }[][] }).inline_keyboard;
  assertEquals(teclado[0][0].callback_data, "ant:c:F01");
  assertEquals(teclado.at(-2)![0].callback_data, "ant:p:1"); // página siguiente

  await procesar(toque(CARLOS, "ant:c:F01", GRUPO, TEMA_FOTOS));
  assertStringIncludes(ultimoTexto(), "Mándame de 1 a 3 fotos.");

  await procesar(mensaje(CARLOS, foto("a1"), GRUPO, TEMA_FOTOS));
  assertStringIncludes(ultimoTexto(), "Guardé 1 foto de F01. Van 1 de 3.");
  await procesar(toque(CARLOS, "ant:fin", GRUPO, TEMA_FOTOS));
  assertStringIncludes(ultimoTexto(), "Listo: F01 · Muro cocina–sala completo quedó con 1 foto ANTES.");

  const carpeta = drive.find((a) => a.name === "F01 Muro cocina–sala completo")!;
  assertEquals(carpeta.parents, [drive.find((a) => a.name === "Antes y después")!.id]);
  const archivo = drive.find((a) => a.parents.includes(carpeta.id))!;
  assertEquals(archivo.name.replace(/\d{4}-\d{2}-\d{2}/, "FECHA"), "ANTES FECHA (1).jpg");
  assertEquals(archivo.appProperties, {
    codigo: "F01",
    nombre: "Muro cocina–sala completo",
    tipo: "antes",
    tareas: "02,09",
    hitos: "H1,H2",
    subido_por: "carlos",
    estado: "sin después",
  });
  assertEquals((tablas.sesiones ?? []).length, 0);

  // F01 ya no aparece en el catálogo.
  limpiar();
  await procesar(mensaje(CARLOS, { text: "/antes" }));
  assertStringIncludes(ultimoTexto(), "Faltan 23 de 24.");
});

Deno.test("fotos ANTES: álbum que llega antes de elegir el código", async () => {
  // La prueba anterior dejó abierto el catálogo en el privado: «Cancelar» lo cierra.
  await procesar(toque(CARLOS, "ant:x"));
  assertEquals((tablas.sesiones ?? []).length, 0);
  limpiar();
  const grupo = { media_group_id: "alb1" };
  await Promise.all([
    procesar(mensaje(CARLOS, { ...foto("b1"), ...grupo })),
    procesar(mensaje(CARLOS, { ...foto("b2"), ...grupo })),
  ]);
  assertStringIncludes(ultimoTexto(), "Recibí 2 fotos. ¿De cuál foto ANTES son?");
  assertEquals((tablas.album_buffer ?? []).length, 0);

  await procesar(toque(CARLOS, "ant:c:F09"));
  const carpeta = drive.find((a) => a.name === "F09 Techo de la cocina y del área de labores")!;
  const fotos = drive.filter((a) => a.parents.includes(carpeta.id)).map((a) =>
    a.name.replace(/\d{4}-\d{2}-\d{2}/, "F")
  );
  assertEquals(fotos, ["ANTES F (1).jpg", "ANTES F (2).jpg"]);
  assertStringIncludes(ultimoTexto(), "Van 2 de 3");
  // La tercera cierra sola.
  await procesar(mensaje(CARLOS, foto("b3")));
  assertStringIncludes(ultimoTexto(), "quedó con 3 fotos ANTES");
});

Deno.test("el hermano no sube ANTES y un error no le muestra detalles técnicos", async () => {
  limpiar();
  await procesar(mensaje(HERMANO, { text: "/antes" }, GRUPO, TEMA_FOTOS));
  assertStringIncludes(ultimoTexto(), "Las fotos ANTES las sube Carlos.");

  limpiar();
  const erroresAntes = (tablas.errores ?? []).length;
  const guardado = hoja.Config;
  hoja.Config = [["clave", "valor"]]; // Config rota: falta fecha_inicio
  await procesar(mensaje(HERMANO, { text: "/estado" }, GRUPO, TEMA_REPORTES));
  hoja.Config = guardado;
  const alHermano = enviados.find((e) => e.params.chat_id === GRUPO)!;
  assertEquals(alHermano.params.text, "No pude procesar eso. Ya le avisé a Carlos.");
  const aCarlos = enviados.find((e) => e.params.chat_id === CARLOS)!;
  assertStringIncludes(String(aCarlos.params.text), "⚠️ Error");
  assertStringIncludes(String(aCarlos.params.text), "fecha_inicio");
  assertEquals(tablas.errores.length, erroresAntes + 1);
});
