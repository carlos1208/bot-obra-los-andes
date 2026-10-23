// Una sola vez: autoriza al bot a usar el Drive de Carlos (permiso drive.file),
// guarda el refresh token en .env.local y crea las carpetas de la obra.
// Uso: deno task oauth-drive
import { loadEnv, required, saveToEnv } from "./_env.ts";
import { createFolder, findOrCreateFolder, FOLDERS } from "../supabase/functions/_shared/drive.ts";
import { SCOPE_DRIVE_FILE } from "../supabase/functions/_shared/google_auth.ts";

await loadEnv();
const clientId = required("GOOGLE_OAUTH_CLIENT_ID");
const clientSecret = required("GOOGLE_OAUTH_CLIENT_SECRET");

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// PKCE (S256) y estado contra falsificación.
const verifier = base64url(crypto.getRandomValues(new Uint8Array(48)));
const challenge = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
const state = base64url(crypto.getRandomValues(new Uint8Array(16)));

const { promise: authCode, resolve, reject } = Promise.withResolvers<string>();
const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen: () => {} }, (req) => {
  const u = new URL(req.url);
  if (u.pathname !== "/") return new Response("", { status: 404 });
  const error = u.searchParams.get("error");
  if (error) {
    reject(new Error(`Google respondió: ${error}`));
    return new Response("No se autorizó. Puedes cerrar esta pestaña.");
  }
  if (u.searchParams.get("state") !== state) {
    reject(new Error("El estado no coincide. Vuelve a correr el script."));
    return new Response("Error de seguridad. Vuelve a correr el script.");
  }
  resolve(u.searchParams.get("code") ?? "");
  return new Response("Listo. Ya puedes cerrar esta pestaña y volver a la terminal.");
});
const redirectUri = `http://127.0.0.1:${server.addr.port}`;

const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
auth.search = new URLSearchParams({
  client_id: clientId,
  redirect_uri: redirectUri,
  response_type: "code",
  scope: SCOPE_DRIVE_FILE,
  access_type: "offline",
  prompt: "consent",
  code_challenge: challenge,
  code_challenge_method: "S256",
  state,
}).toString();

console.log("Abre este enlace, entra con tu cuenta de Gmail y acepta:\n");
console.log(auth.toString(), "\n");
try {
  const open = Deno.build.os === "windows"
    ? new Deno.Command("rundll32", { args: ["url.dll,FileProtocolHandler", auth.toString()] })
    : new Deno.Command(Deno.build.os === "darwin" ? "open" : "xdg-open", { args: [auth.toString()] });
  open.spawn();
} catch {
  // Si no se puede abrir el navegador, el enlace ya está en pantalla.
}

const code = await authCode;
await server.shutdown();

const r = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
    code_verifier: verifier,
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
await saveToEnv("GOOGLE_OAUTH_REFRESH_TOKEN", tokens.refresh_token);
console.log("Refresh token guardado en .env.local.");

// Carpetas de la obra. Con drive.file el bot solo ve lo que crea, así que las crea él.
let rootId = Deno.env.get("DRIVE_ROOT_FOLDER_ID") ?? "";
if (!rootId) {
  const root = await createFolder("Obra Los Andes", "root");
  rootId = root.id;
  await saveToEnv("DRIVE_ROOT_FOLDER_ID", rootId);
  console.log(`Carpeta creada: ${root.webViewLink}`);
}
for (const name of Object.values(FOLDERS)) {
  await findOrCreateFolder(name, rootId);
  console.log(`  · ${name}`);
}
console.log("Listo. DRIVE_ROOT_FOLDER_ID quedó en .env.local.");
