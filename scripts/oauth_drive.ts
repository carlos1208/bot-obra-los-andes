// Una sola vez: autoriza al bot a usar el Drive de Carlos (permiso drive.file),
// guarda el refresh token en .env.local y crea las carpetas de la obra.
// Uso: deno task oauth-drive
import { cargarEnv, guardarEnEnv, requerido } from "./_env.ts";
import { buscarOCrearCarpeta, CARPETAS, crearCarpeta } from "../supabase/functions/_shared/drive.ts";
import { SCOPE_DRIVE_FILE } from "../supabase/functions/_shared/google_auth.ts";

await cargarEnv();
const clientId = requerido("GOOGLE_OAUTH_CLIENT_ID");
const clientSecret = requerido("GOOGLE_OAUTH_CLIENT_SECRET");

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// PKCE (S256) y estado contra falsificación.
const verificador = base64url(crypto.getRandomValues(new Uint8Array(48)));
const reto = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verificador))));
const estado = base64url(crypto.getRandomValues(new Uint8Array(16)));

const { promise: codigo, resolve, reject } = Promise.withResolvers<string>();
const servidor = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen: () => {} }, (req) => {
  const u = new URL(req.url);
  if (u.pathname !== "/") return new Response("", { status: 404 });
  const error = u.searchParams.get("error");
  if (error) {
    reject(new Error(`Google respondió: ${error}`));
    return new Response("No se autorizó. Puedes cerrar esta pestaña.");
  }
  if (u.searchParams.get("state") !== estado) {
    reject(new Error("El estado no coincide. Vuelve a correr el script."));
    return new Response("Error de seguridad. Vuelve a correr el script.");
  }
  resolve(u.searchParams.get("code") ?? "");
  return new Response("Listo. Ya puedes cerrar esta pestaña y volver a la terminal.");
});
const redirectUri = `http://127.0.0.1:${servidor.addr.port}`;

const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
auth.search = new URLSearchParams({
  client_id: clientId,
  redirect_uri: redirectUri,
  response_type: "code",
  scope: SCOPE_DRIVE_FILE,
  access_type: "offline",
  prompt: "consent",
  code_challenge: reto,
  code_challenge_method: "S256",
  state: estado,
}).toString();

console.log("Abre este enlace, entra con tu cuenta de Gmail y acepta:\n");
console.log(auth.toString(), "\n");
try {
  const abrir = Deno.build.os === "windows"
    ? new Deno.Command("rundll32", { args: ["url.dll,FileProtocolHandler", auth.toString()] })
    : new Deno.Command(Deno.build.os === "darwin" ? "open" : "xdg-open", { args: [auth.toString()] });
  abrir.spawn();
} catch {
  // Si no se puede abrir el navegador, el enlace ya está en pantalla.
}

const code = await codigo;
await servidor.shutdown();

const r = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
    code_verifier: verificador,
  }),
});
const tokens = await r.json();
if (!r.ok) {
  console.error(`Google rechazó el código: ${tokens.error} ${tokens.error_description ?? ""}`);
  Deno.exit(1);
}
if (!tokens.refresh_token) {
  console.error("Google no entregó refresh token. Quita el acceso de la app en");
  console.error("https://myaccount.google.com/connections y vuelve a correr el script.");
  Deno.exit(1);
}
await guardarEnEnv("GOOGLE_OAUTH_REFRESH_TOKEN", tokens.refresh_token);
console.log("Refresh token guardado en .env.local.");

// Carpetas de la obra. Con drive.file el bot solo ve lo que crea, así que las crea él.
let raizId = Deno.env.get("DRIVE_ROOT_FOLDER_ID") ?? "";
if (!raizId) {
  const raiz = await crearCarpeta("Obra Los Andes", "root");
  raizId = raiz.id;
  await guardarEnEnv("DRIVE_ROOT_FOLDER_ID", raizId);
  console.log(`Carpeta creada: ${raiz.webViewLink}`);
}
for (const nombre of Object.values(CARPETAS)) {
  await buscarOCrearCarpeta(nombre, raizId);
  console.log(`  · ${nombre}`);
}
console.log("Listo. DRIVE_ROOT_FOLDER_ID quedó en .env.local.");
