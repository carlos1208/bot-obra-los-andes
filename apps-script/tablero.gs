// Bot de obra – tablero. App web que solo muestra la página que arma la Edge Function «tablero»
// (Supabase no sirve HTML en su dominio gratuito). No lee la hoja ni Drive: le pasa a la función el código
// del enlace (…/exec?t=<código>) y muestra lo que devuelve. El código lo revisa la función.
//
// Propiedad del script (Configuración del proyecto → Propiedades de la secuencia de comandos):
//   FUNCION_URL = https://<PROJECT_REF>.supabase.co/functions/v1/tablero

function doGet(e) {
  const codigo = (e && e.parameter && e.parameter.t) || "";
  const url = PropertiesService.getScriptProperties().getProperty("FUNCION_URL");
  let html;
  if (!url) html = aviso("Falta la propiedad FUNCION_URL del script.");
  else if (!codigo) html = aviso("Este enlace no está completo. Pídele uno nuevo al bot con /tablero.");
  else html = pagina(url, codigo);
  return HtmlService.createHtmlOutput(html)
    .setTitle("Obra Los Andes")
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}

function pagina(url, codigo) {
  try {
    const r = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({ t: codigo }),
      muteHttpExceptions: true,
      timeoutSeconds: 90,
    });
    const texto = r.getContentText("UTF-8");
    return r.getResponseCode() === 200 ? texto : aviso(texto || "No pude abrir el tablero.");
  } catch (err) {
    return aviso("No pude abrir el tablero. Intenta otra vez en un rato.");
  }
}

function aviso(texto) {
  const seguro = String(texto).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return '<div style="font:16px system-ui,sans-serif;padding:24px;max-width:480px;margin:auto">' +
    "<h1 style=\"font-size:20px\">Obra Los Andes</h1><p>" + seguro + "</p></div>";
}
