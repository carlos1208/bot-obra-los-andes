# Bot de obra – Apto 202 Los Andes

Bot de Telegram para la remodelación del apto 202 (Calle 57 # 23-129, Los Andes, Barranquilla). Los datos viven en un
Google Sheet, las fotos en Google Drive y el bot corre en Supabase Edge Functions.

```
Telegram (grupo con temas + privado de Carlos)
   │  webhook (secret_token)
   ▼
Edge Function "telegram" ──► enrutador ──► agente (/estado, fotos ANTES, …)
   │                                          │
   ▼                                          ▼
Postgres (solo estado técnico)      Google Sheet (datos) + Google Drive (fotos)
```

## Estado por fases

| Fase                   | Qué incluye                                                                                                     | Estado        |
| ---------------------- | --------------------------------------------------------------------------------------------------------------- | ------------- |
| 1. Base                | Hoja desde `semillas/`, OAuth de Drive, webhook, `/estado` y recepción de fotos ANTES de Carlos con el catálogo | Lista         |
| 2. Validación de la IA | Facturas reales y nota de voz contra Gemini                                                                     | Lista         |
| 3. MVP                 | Enrutador, reporte diario por notas con tareas terminadas y avance, gastos con caja menor y reintentos          | Lista         |
| 4. Antes y después     | DESPUÉS, validación, `/pendientes`, ANTES por imprevisto, «Otro nombre», pares en el reporte                    | Lista         |
| 5. Pagos y consultas   | Pagos, hitos, reposición de caja menor, preguntas libres                                                        | **En prueba** |
| 6. Programados         | Avisos del lunes, diarios y cierre del sábado                                                                   | Pendiente     |

## Estructura

```
semillas/                 CSV de cada pestaña, catálogo fotos_antes.json, facturas_esperadas.csv
scripts/                  Scripts locales: ids de Telegram, crear la hoja, OAuth de Drive, webhook, validar la IA
supabase/migrations/      Tablas técnicas (updates, sesiones, álbumes, reintentos, errores)
supabase/functions/
  _shared/                Clientes de Telegram, Sheets, Drive, Gemini y Postgres; extractores; reglas de la obra
  telegram/               Webhook, enrutador y agentes
tests/                    deno test
```

## Configuración paso a paso

Todo se corre desde la carpeta del repo en tu PC. Los secretos van solo en `.env.local` (está en `.gitignore`) y en
`supabase secrets set`. Nunca en el código ni en el chat.

Algunos scripts escriben en `.env.local` (`secreto`, `cuenta-servicio`, `oauth-drive`). **Cierra el Bloc de notas antes
de correrlos**: si lo guardas después, escribe su copia vieja encima. `deno task revisar` muestra qué valores están
llenos sin mostrarlos.

### 0. Herramientas

1. Instala Deno. En PowerShell: `irm https://deno.land/install.ps1 | iex`
2. Instala Node.js LTS (para `npx supabase`).
3. Clona el repo y entra a la rama de la fase:
   ```
   git clone https://github.com/carlos1208/bot-obra-los-andes
   cd bot-obra-los-andes
   git checkout fase-1-base
   copy .env.example .env.local
   ```
4. Genera el secreto del webhook (lo guarda en `.env.local` sin mostrarlo): `deno task secreto`

### 1. Bot de Telegram

1. En Telegram abre **@BotFather** → `/newbot` → nombre «Obra Los Andes» y un usuario que termine en `bot`.
2. Copia el token en `TELEGRAM_BOT_TOKEN` de `.env.local`.
3. **Antes de agregarlo al grupo:** `/setprivacy` → elige el bot → **Disable**. Si no, el bot no recibe las fotos ni los
   mensajes normales del grupo.

### 2. Grupo con temas

1. Crea el grupo «Obra Los Andes» con tu hermano.
2. Ajustes del grupo → activa **Temas**. Telegram lo convierte en supergrupo.
3. Crea los temas `Reportes`, `Antes y después` y `Gastos` (con esos nombres).
4. Agrega el bot y hazlo **administrador**.

### 3. Ids de Telegram

1. Tú y tu hermano escriben cualquier cosa en cada uno de los tres temas.
2. Tú le escribes `/start` al bot por privado.
3. Corre `deno task ids` y copia los valores en `.env.local`: `CARLOS_TG_ID`, `HERMANO_TG_ID`, `GROUP_CHAT_ID`,
   `TOPIC_REPORTES_ID`, `TOPIC_FOTOS_ID`, `TOPIC_GASTOS_ID`.
4. Si tu hermano todavía no está en el grupo, deja `HERMANO_TG_ID` vacío: el bot funciona solo para ti. Cuando entre,
   corre `deno task ids --borrar-webhook`, escribe en un tema, `deno task ids` y vuelve a activar con
   `deno task webhook`.

### 4. Google Cloud: cuenta de servicio para la hoja

1. En <https://console.cloud.google.com> crea el proyecto «obra-los-andes».
2. APIs y servicios → Biblioteca → habilita **Google Sheets API** y **Google Drive API**.
3. IAM → Cuentas de servicio → Crear. Nombre «bot-hoja». Sin roles.
4. En la cuenta → Claves → Agregar clave → JSON. Se descarga un archivo `.json`.
5. Corre `deno task cuenta-servicio "C:\ruta\al\archivo.json"`. Guarda `GOOGLE_SA_EMAIL` y `GOOGLE_SA_PRIVATE_KEY` en
   `.env.local` y muestra el correo con el que vas a compartir la hoja.
6. Borra el JSON descargado.

### 5. La hoja

1. Crea una hoja de cálculo vacía en tu Drive, por ejemplo «Obra Los Andes – datos».
2. Compártela con el correo de la cuenta de servicio como **Editor**.
3. Copia el id de la URL (`/spreadsheets/d/<ESTE>/edit`) en `SHEET_ID`.
4. Corre `deno task crear-hoja`. Crea las 9 pestañas, congela la fila 1, da formato de pesos y fechas, y agrega las
   fórmulas de `Presupuesto` (`gastado`, `saldo`) y de `Hitos` (`valor_a_pagar`). Deja la hoja en español de Colombia y
   en hora de Bogotá.

### 6. Google Drive con tu cuenta (OAuth)

Las cuentas de servicio no tienen cuota en el «Mi unidad» de un Gmail personal. Por eso Drive usa tu cuenta, con el
permiso mínimo `drive.file`: el bot solo ve lo que él mismo crea.

1. En la consola de Google Cloud → **Google Auth Platform**:
   - Marca: nombre «Bot obra Los Andes» y tu correo.
   - Público: **Externo**. Luego **Publicar app** para dejarla **En producción**. En «Prueba», el refresh token vence a
     los 7 días. **Si Google pide verificación, para y avísame antes de seguir.**
   - Clientes → Crear cliente → tipo **App de escritorio**.
2. Copia el id y el secreto del cliente en `GOOGLE_OAUTH_CLIENT_ID` y `GOOGLE_OAUTH_CLIENT_SECRET`.
3. Corre `deno task oauth-drive`. Se abre el navegador. Entra con tu Gmail y acepta. Si sale «Google no verificó esta
   app», toca _Configuración avanzada_ → _Ir a …_.
4. El script guarda `GOOGLE_OAUTH_REFRESH_TOKEN` y `DRIVE_ROOT_FOLDER_ID` en `.env.local` y crea `Obra Los Andes/` con
   `Antes y después/`, `Facturas/` y `Notas de voz/`.

### 7. Supabase

1. En <https://supabase.com/dashboard> crea el proyecto «bot-obra-los-andes» en el plan gratuito (región `us-east-1`).
   Copia el _project ref_ (el id de la URL) en `PROJECT_REF`.
2. En la terminal:
   ```
   npx supabase login
   npx supabase link --project-ref <PROJECT_REF>
   npx supabase db push
   deno task secretos
   npx supabase functions deploy telegram --use-api
   ```
   `--use-api` empaqueta en Supabase y no necesita Docker.

### 8. Webhook

`deno task webhook` activa el webhook con `secret_token`, deja solo `message` y `callback_query` y registra los comandos
`/reporte`, `/gasto`, `/estado` y `/antes`.

### 9. Gemini (fase 2)

1. En <https://aistudio.google.com> entra con tu Gmail y acepta los términos.
2. Como ya tienes el proyecto «obra-los-andes» en Google Cloud, AI Studio no crea uno solo: menú izquierdo → Dashboard →
   **Projects** → **Import projects** → elige «obra-los-andes» → **Import**.
3. Dashboard → **API Keys** → **Create API key** en ese proyecto. No actives facturación: sin ella la clave queda en el
   nivel gratuito.
4. Copia la clave en `GEMINI_API_KEY` de `.env.local` y corre `deno task secretos`.

### Prueba de la fase 1

- `/estado` en el tema Reportes → semana de obra y tareas de hoy, **sin dinero**.
- `/estado` en tu privado → lo mismo más el disponible de los 12 M.
- Cambia en la hoja las fechas de una tarea para que caiga hoy y repite `/estado`: debe salir de una vez.
- `/antes` en el tema «Antes y después» → elige F01 → manda 1 a 3 fotos → «Listo». Revisa en Drive
  `Obra Los Andes/Antes y después/F01 …/ANTES AAAA-MM-DD (1).jpg`.

### Prueba de la fase 2

Necesitas la foto de una factura impresa (tomada con el celular) y una nota de voz de Telegram en `.ogg` (en Telegram
Desktop o en <https://web.telegram.org>: clic derecho sobre la nota → Guardar como / Descargar).

```
deno task validar-ia --facturas "C:\Users\Carlos\Documents\Documentos personales\Los Andes\05 Facturas y pagos\Facturas" --foto "C:\ruta\factura1.jpg" --foto "C:\ruta\factura2.jpg" --voz "C:\ruta\nota.ogg"
```

- Lee los capítulos de `Presupuesto` en la hoja y pasa a Gemini las 4 facturas PDF y las fotos (`--foto` se puede
  repetir).
- Compara número, fecha y total con `semillas/facturas_esperadas.csv`. El número se compara sin espacios ni guiones.
- Lista los productos de cada factura (cantidad, nombre y valor de la línea) y dice si suman el total.
- Si el modelo principal falla en alguna de las 4, repite con el de respaldo y dice cuál quedó.
- Transcribe y resume la nota de voz (`audio/ogg`) con el modelo que quedó.
- **Criterio:** número, fecha y total exactos en las 4 facturas PDF. Las fotos que no están en el CSV y la nota de voz
  se revisan a ojo.

### Prueba de la fase 3

Antes: `git pull`, `deno task test`, `deno task crear-hoja --reemplazar Reportes,Notas` (pone los encabezados nuevos de
`Reportes` y borra las filas de prueba de las dos pestañas), `npx supabase functions deploy telegram --use-api` y
`deno task webhook` (registra `/reporte` y `/gasto` en el menú). Mientras tu hermano no esté, haz todo tú.

**Reporte del día** (tema Reportes):

1. Manda notas de voz o textos con lo que se hizo. A cada una el bot responde «¿Quisiste decir esto?» con un resumen:
   - «Sí»: la nota queda en `Notas` y sale el resumen del día con todas las notas y el botón «Cerrar el reporte».
   - «No»: pide una aclaración en texto u otro audio y vuelve a preguntar. «Descartar la nota» no guarda nada.
   - Una nota que llega antes de responder espera su turno.
2. «Cerrar el reporte»: llega la lista numerada de todas las tareas pendientes, por sección (⏰ = atrasada). Responde
   con los números de las terminadas separados por guion (`2-5`; los espacios no importan) o toca «Ninguna». El bot
   confirma cuáles entendió.
3. Si hay algo esperado hoy, marca «Llegó» o «No llegó» (con «No llegó» te llega el aviso por privado en el momento).
4. Vista previa: resumen del día, quién terminó qué, avance de la obra y de la sección contra el cronograma (con el
   desvío), lo que sigue, compras, caja menor y lo esperado. «Corregir tareas», «Corregir lo esperado» y «Agregar
   compra» llevan al paso y vuelven aquí.
5. «Sí, guardar»: fila en `Reportes`, `estado` en `Tareas`, `llego` en `Esperado` y el resumen por privado. Manda otra
   nota después y toca «Actualizar el reporte»: sigue habiendo una sola fila de hoy, actualizada.

**Gastos** (tema Gastos):

- **Compra por caja menor:** foto de una factura de menos de $100.000 → «Caja menor» → «Corregir campo» en algo → «Sí,
  guardar». Revisa la fila en `Gastos`, la foto en Drive `Facturas/` y el saldo de la caja.
- **Compra por encima del tope:** factura de más de $100.000 con «Caja menor» → debe pasar a «Pagó Carlos» y avisarte
  por privado.
- **Opcional:** un PDF de factura por tu privado y una compra sin factura (máximo $10.000 y una por día).

La sección «Fotos» del reporte sale con «—» hasta la fase 4.

### Prueba de la fase 4

Antes: `git pull`, `deno task test`, `npx supabase functions deploy telegram --use-api` y `deno task webhook` (registra
`/despues` y `/pendientes`).

- **F01 con su ANTES y su DESPUÉS.** El ANTES de F01 ya está en Drive desde la fase 1.
  1. En el tema «Antes y después», `/despues` → F01 (📅 = de tareas de esta semana). El bot manda el ANTES de
     referencia; manda la foto DESPUÉS desde el mismo ángulo.
  2. Te llega por privado el par como álbum, con las tareas, el hito y su criterio, y los botones «Cierre validado», «No
     cuadra, reviso en sitio» y «Pedir otra foto». Prueba «Pedir otra foto» (el pedido sale en el tema con el botón
     «Subir DESPUÉS»), sube otra y luego «No cuadra…».
  3. `/pendientes` por privado: F01 sale en «Revisar en sitio». «Ver F01» → «Cierre validado».
  4. En Drive, `Antes y después/F01 …/` tiene `ANTES … (1).jpg` y `DESPUÉS … (1).jpg`; el estado está en las
     appProperties (no en la hoja).
- **ANTES por imprevisto del hermano:** foto en el tema → «ANTES por imprevisto» → nombre corto → motivo → «Listo». Te
  llega por privado con «Aprobar» y «Rechazar». Al aprobar, Gemini propone las tareas: «Sí» o «Cambiar» y escribes los
  números (`23-27`). Necesita a tu hermano (o, mientras tanto, otra cuenta de Telegram en `HERMANO_TG_ID`).
- **«Otro nombre» (Carlos):** `/antes` → «Otro nombre» → nombre corto → confirma las tareas → foto. Queda como F25, F26…
- **Reporte:** el día que se sube un DESPUÉS, la sección «Fotos» lo nombra («F01 Muro cocina–sala completo: antes y
  después (tareas 02, 09; H1, H2), por validar»). Si marcas terminada una tarea cuyo ANTES no tiene DESPUÉS, avisa.

### Prueba de productos y facturas repetidas

Antes: `git pull`, `deno task test`, `deno task crear-hoja` (crea la pestaña `Productos` con los 38 productos de las 4
facturas reales; no toca las demás) y `npx supabase functions deploy telegram --use-api`.

Opcional: `deno task validar-ia --facturas "…"` lista los productos que lee Gemini de las 4 facturas y dice si suman el
total.

- **Productos:** foto de una factura con varios productos en el tema Gastos. La vista previa los lista uno por línea con
  su valor y avisa si falta un valor o si no suman el total. «Corregir campo» → «Productos»: el bot manda la lista;
  cópiala, corrige y mándala completa (una línea por producto: `2 Cemento gris de 50 kg 64.000`). Al guardar, cada
  producto queda en `Productos` con el número de la factura y el enlace a Drive.
- **Factura repetida:** vuelve a mandar la misma factura. La vista previa avisa «⚠️ Esta factura ya está registrada…»
  con la fecha y quién la registró; «Cancelar» no guarda nada. Si alguien la registra mientras tienes la vista previa
  abierta, el aviso sale al tocar «Sí, guardar» y se guarda solo si vuelves a tocarlo.
- **Compra sin factura:** queda una fila en `Productos` con lo que se compró, sin número de factura.

### Prueba de la fase 5

Antes: `git pull`, `deno task test`, `npx supabase functions deploy telegram --use-api` y `deno task webhook` (registra
`/pago` en el menú). Todo va por el privado con el bot: un texto o una nota de voz lo lee Gemini y decide si es un pago,
una reposición de caja menor o una pregunta.

1. **Pago de 700.000 al albañil:** «le pagué 700 mil al albañil por Nequi» (o `/pago` y luego el mensaje).
   - Vista previa: a quién, concepto, valor, medio, fecha, capítulo y «Cuenta en los 12 M: sí».
   - El pago no se liga a un hito: `Hitos` no se toca al pagar (lo manejas tú). Si dices «por el H1», queda en el
     concepto.
   - Control: avisa si lo pagado al albañil pasaría del total más la reserva (`total_albanil` y `reserva_albanil`).
   - «Corregir campo» cambia cualquier dato (a quién y el capítulo con botones; el valor, la fecha y el resto,
     escritos).
   - «Sí, guardar»: fila en `Pagos`. Responde con lo pagado al albañil y el disponible de los 12 M.
2. **Reposición de caja menor:** «repuse 87.500 de caja menor». La vista previa muestra el efectivo esperado y las
   facturas sin reponer. Al guardar queda en `Pagos` con `a_quien = Caja menor` y `cuenta_12M = no`, y responde con el
   arqueo: efectivo esperado antes de reponer + facturas sin reponer = fondo (100.000). Avisa si lo repuesto no es igual
   a las facturas.
3. **«Marcar H2 cumplido»** (texto exacto, sin Gemini, solo si lo escribes): muestra el criterio del hito; «Cambiar
   fecha» o «Sí, guardar» pone `fecha_cumplido`.
4. **Tres consultas:**
   - Tú: «¿cuánto queda de los 12 M?» y «¿qué debe llegar hoy?». La respuesta termina con «Dato de la hoja, hh:mm».
   - Tu hermano, por su privado: «¿cuánto se le ha pagado al albañil?» → «Eso lo ve solo Carlos.»
     (`hermano_ve_dinero = no`). Sí le responde lo que no es dinero («¿qué toca esta semana?»).
   - Para cada pregunta, Gemini dice qué datos necesita y el bot lee solo esas pestañas en ese momento: si corriges una
     celda, la siguiente respuesta ya la usa.

## Uso diario

- **Cambiar el modelo de Gemini:** `npx supabase secrets set GEMINI_MODEL=<modelo>` (o `GEMINI_MODEL_FALLBACK`). No hay
  que volver a desplegar.
- **Volver a cargar las semillas:** `deno task crear-hoja --reemplazar Tareas,Objetivos`. Sin `--reemplazar` no toca los
  datos de las pestañas que ya los tienen; si la semilla trae columnas nuevas, las agrega al final del encabezado.
  `--reemplazar todas` borra también Reportes, Gastos, Productos y Pagos.
- **Cambiar el catálogo de fotos ANTES:** edita `semillas/fotos_antes.json`, corre `deno task catalogo` y vuelve a
  desplegar `telegram`. Una prueba falla si las dos copias no son iguales.
- **Pruebas:** `deno task test`. Revisión de tipos: `deno task check`.
- **Errores:** quedan en la tabla `errores` y te llega una línea por privado. Tu hermano nunca ve detalles técnicos.
- **Gemini sin cuota (429):** el bot responde «Lo proceso en unos minutos», guarda el mensaje en `cola_reintentos` y lo
  reintenta al minuto. Si sigue sin cuota, espera más (2, 5, 10… hasta 60 min) y el reintento corre con el siguiente
  mensaje que llegue.
- **Proyecto en pausa:** Supabase pausa los proyectos gratuitos que pasan una semana sin actividad. Con el bot en uso no
  debería pasar; si pasa, se reactiva desde el panel.

## Rotar claves

Después de cambiar cualquier valor en `.env.local`: `deno task secretos`.

| Clave                        | Cómo                                                                                           |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN`         | BotFather → `/revoke`. Pega el nuevo token y corre `deno task webhook`.                        |
| `TELEGRAM_WEBHOOK_SECRET`    | `deno task secreto`, `deno task secretos` y `deno task webhook`.                               |
| `GOOGLE_SA_PRIVATE_KEY`      | Crea una clave nueva en la cuenta de servicio, cámbiala y borra la vieja.                      |
| `GOOGLE_OAUTH_REFRESH_TOKEN` | Quita el acceso en <https://myaccount.google.com/connections> y corre `deno task oauth-drive`. |
| `GEMINI_API_KEY`             | Crea una nueva en Google AI Studio y borra la vieja.                                           |
| Claves de Supabase           | Se rotan en el panel. Las funciones las reciben solas.                                         |

## Semillas

`semillas/` es copia de `Los Andes/07 App de reportes/semillas/` en el Drive de Carlos (cronograma v5 del 22 oct 2026).
Si cambias una semilla allá, cópiala aquí y vuelve a cargarla con `deno task crear-hoja --reemplazar <Pestaña>`.

- `Tareas.csv`: las 46 tareas del cronograma v5 (00–42 y Z1–Z3 tentativas).
- `fotos_antes.json`: catálogo F01–F24 con encuadre, tareas e hitos.
- `Gastos.csv` y `Pagos.csv`: lo pagado antes de la obra, con `cuenta_12M = no`.
- `Productos.csv`: un producto por línea de cada factura, con `numero_factura` y `enlace_factura` para cruzarlo con
  `Gastos`. Trae los 38 productos de las 4 facturas reales (leídos de los PDF; cada factura suma su total).
  `valor_total` es lo pagado por la línea (con IVA y descuento) y `valor_unitario` es `valor_total / cantidad`.
- `facturas_esperadas.csv`: los valores de las 4 facturas reales para la fase 2.
- `Reportes.csv`: solo encabezados. Una fila por día: resumen, tareas terminadas (`02-05`), avance de la obra contra el
  cronograma (`avance_obra_pct`, `avance_esperado_pct`, `desvio_pct`, ponderados por los días de cada tarea), lo que
  sigue, lo esperado, compras, caja menor y el texto completo.
- `Notas.csv`: solo encabezados. Cada nota confirmada del tema Reportes queda ahí: la transcripción y, en `resumen`, lo
  que el bot entendió y se confirmó con «Sí». El reporte del día se arma con `resumen`: si lo corriges en la hoja, la
  siguiente nota ya usa tu corrección.

El mapa de la carpeta del Drive está en `CLAUDE.md`.
