// Copia el correo y la clave de la cuenta de servicio desde el JSON que descarga Google
// a .env.local, para no pegar a mano una clave de 1.700 caracteres.
// Uso: deno task cuenta-servicio "C:\Users\Carlos\Downloads\obra-los-andes-xxxx.json"
import { saveToEnv } from "./_env.ts";

const path = Deno.args[0];
if (!path) {
  console.error('Uso: deno task cuenta-servicio "ruta\\al\\archivo.json"');
  Deno.exit(1);
}

let key: { type?: string; client_email?: string; private_key?: string };
try {
  key = JSON.parse(await Deno.readTextFile(path));
} catch {
  console.error(`No pude leer ${path} como JSON. Revisa la ruta (ponla entre comillas).`);
  Deno.exit(1);
}
if (key.type !== "service_account" || !key.client_email || !key.private_key) {
  console.error("Ese JSON no es la clave de una cuenta de servicio.");
  Deno.exit(1);
}

await saveToEnv("GOOGLE_SA_EMAIL", key.client_email);
// Una sola línea entre comillas, con los saltos de línea como \n.
await saveToEnv("GOOGLE_SA_PRIVATE_KEY", `"${key.private_key.replace(/\r?\n/g, "\\n")}"`);
console.log("Listo: GOOGLE_SA_EMAIL y GOOGLE_SA_PRIVATE_KEY quedaron en .env.local.");
console.log(`Comparte la hoja con este correo como Editor: ${key.client_email}`);
console.log("Ya puedes borrar el archivo JSON.");
