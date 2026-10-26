// Bot de obra – facturas del correo. Corre en la cuenta de Gmail de Carlos, publicado como app web.
// Nada revisa el correo por su cuenta: el bot lo llama solo cuando Carlos escribe /correo.
//
// Acciones (POST con JSON y el secreto):
//   {accion: "buscar", dias: 30}  facturas electrónicas de la DIAN (asunto «NIT;Empresa;Número;01;…» con un .zip)
//                                 de los últimos días que todavía no tienen la etiqueta
//   {accion: "factura", id}       el PDF (en base64) y el XML de esa factura, sacados del .zip
//   {accion: "marcar", id}        le pone la etiqueta al correo para que no vuelva a salir
//
// El secreto va en Configuración del proyecto → Propiedades de la secuencia de comandos → SECRETO
// (el mismo valor de GMAIL_SCRIPT_SECRET en .env.local).

const ETIQUETA = "Obra registrada";

function doPost(e) {
  let pedido;
  try {
    pedido = JSON.parse(e.postData.contents);
  } catch (_) {
    return responder({ error: "pedido inválido" });
  }
  const secreto = PropertiesService.getScriptProperties().getProperty("SECRETO");
  if (!secreto || pedido.secreto !== secreto) return responder({ error: "no autorizado" });
  try {
    if (pedido.accion === "buscar") return responder(buscar(Number(pedido.dias) || 30));
    if (pedido.accion === "factura") return responder(factura(pedido.id));
    if (pedido.accion === "marcar") return responder(marcar(pedido.id));
    return responder({ error: "acción desconocida" });
  } catch (err) {
    return responder({ error: String(err) });
  }
}

function buscar(dias) {
  // En la búsqueda de Gmail, los espacios del nombre de la etiqueta van como guiones.
  const sinEtiqueta = "-label:" + ETIQUETA.toLowerCase().replace(/\s+/g, "-");
  const consulta = "filename:zip newer_than:" + dias + "d " + sinEtiqueta;
  const facturas = [];
  for (const hilo of GmailApp.search(consulta, 0, 50)) {
    for (const m of hilo.getMessages()) {
      // Asunto de la DIAN: NIT;Razón social;Número;01 (factura de venta);…
      const partes = m.getSubject().split(";").map(function (p) {
        return p.trim();
      });
      if (partes.length < 4 || partes[3] !== "01" || !/^\d{6,12}$/.test(partes[0])) continue;
      const conZip = m.getAttachments().some(function (a) {
        return /\.zip$/i.test(a.getName());
      });
      if (!conZip) continue;
      facturas.push({
        id: m.getId(),
        fecha: m.getDate().toISOString(),
        nit: partes[0],
        empresa: partes[1].replace(/\s+/g, " "),
        numero: partes[2],
        remitente: m.getFrom(),
      });
    }
  }
  return { facturas: facturas };
}

function factura(id) {
  const m = GmailApp.getMessageById(id);
  const zip = m.getAttachments().filter(function (a) {
    return /\.zip$/i.test(a.getName());
  })[0];
  if (!zip) return { error: "el correo no trae un .zip" };
  const archivos = Utilities.unzip(zip.copyBlob().setContentType("application/zip"));
  const pdf = archivos.filter(function (b) {
    return /\.pdf$/i.test(b.getName());
  })[0];
  const xml = archivos.filter(function (b) {
    return /\.xml$/i.test(b.getName());
  })[0];
  return {
    id: id,
    remitente: m.getFrom(),
    pdf: pdf ? Utilities.base64Encode(pdf.getBytes()) : null,
    xml: xml ? xml.getDataAsString("UTF-8") : null,
  };
}

function marcar(id) {
  const etiqueta = GmailApp.getUserLabelByName(ETIQUETA) || GmailApp.createLabel(ETIQUETA);
  GmailApp.getMessageById(id).getThread().addLabel(etiqueta);
  return { ok: true };
}

function responder(objeto) {
  return ContentService.createTextOutput(JSON.stringify(objeto)).setMimeType(ContentService.MimeType.JSON);
}
