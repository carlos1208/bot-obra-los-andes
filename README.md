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
| 1. Base                | Hoja desde `semillas/`, OAuth de Drive, webhook, `/estado` y recepción de fotos ANTES de Carlos con el catálogo | **En prueba** |
| 2. Validación de la IA | Facturas reales y nota de voz contra Gemini                                                                     | Pendiente     |
| 3. MVP                 | Reporte diario y gastos con caja menor                                                                          | Pendiente     |
| 4. Antes y después     | DESPUÉS, validación, `/pendientes`, ANTES por imprevisto, «Otro nombre»                                         | Pendiente     |
| 5. Pagos y consultas   | Pagos, hitos, reposición de caja menor, preguntas libres                                                        | Pendiente     |
| 6. Programados         | Avisos del lunes, diarios y cierre del sábado                                                                   | Pendiente     |

## Estructura

```
semillas/                 CSV de cada pestaña, catálogo fotos_antes.json, facturas_esperadas.csv
scripts/                  Scripts locales: ids de Telegram, crear la hoja, OAuth de Drive, webhook
supabase/migrations/      Tablas técnicas (updates, sesiones, álbumes, reintentos, errores)
supabase/functions/
  _shared/                Clientes de Telegram, Sheets, Drive y Postgres; reglas de la obra
  telegram/               Webhook, enrutador y agentes
tests/                    deno test
```

## Configuración paso a paso

Todo se corre desde la carpeta del repo en tu PC. Los secretos van solo en `.env.local` (está en `.gitignore`) y en
`supabase secrets set`. Nunca en el código ni en el chat.

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

### 4. Google Cloud: cuenta de servicio para la hoja

1. En <https://console.cloud.google.com> crea el proyecto «obra-los-andes».
2. APIs y servicios → Biblioteca → habilita **Google Sheets API** y **Google Drive API**.
3. IAM → Cuentas de servicio → Crear. Nombre «bot-hoja». Sin roles.
4. En la cuenta → Claves → Agregar clave → JSON. Del archivo descargado copia:
   - `client_email` → `GOOGLE_SA_EMAIL`
   - `private_key` → `GOOGLE_SA_PRIVATE_KEY`, entre comillas dobles y con los `\n` tal cual.
5. Borra el JSON descargado.

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
   npx supabase secrets set --env-file .env.local
   npx supabase functions deploy telegram --use-api
   ```
   `--use-api` empaqueta en Supabase y no necesita Docker.

### 8. Webhook

`deno task webhook` activa el webhook con `secret_token`, deja solo `message` y `callback_query` y registra los comandos
`/estado` y `/antes`.

### Prueba de la fase 1

- `/estado` en el tema Reportes → semana de obra y tareas de hoy, **sin dinero**.
- `/estado` en tu privado → lo mismo más el disponible de los 12 M.
- Cambia en la hoja las fechas de una tarea para que caiga hoy y repite `/estado`: debe salir de una vez.
- `/antes` en el tema «Antes y después» → elige F01 → manda 1 a 3 fotos → «Listo». Revisa en Drive
  `Obra Los Andes/Antes y después/F01 …/ANTES AAAA-MM-DD (1).jpg`.

## Uso diario

- **Cambiar el modelo de Gemini:** `npx supabase secrets set GEMINI_MODEL=<modelo>` (o `GEMINI_MODEL_FALLBACK`). No hay
  que volver a desplegar.
- **Volver a cargar las semillas:** `deno task crear-hoja --reemplazar Tareas,Objetivos`. Sin `--reemplazar` no toca las
  pestañas que ya tienen datos. `--reemplazar todas` borra también Reportes, Gastos y Pagos.
- **Cambiar el catálogo de fotos ANTES:** edita `semillas/fotos_antes.json`, corre `deno task catalogo` y vuelve a
  desplegar `telegram`. Una prueba falla si las dos copias no son iguales.
- **Pruebas:** `deno task test`. Revisión de tipos: `deno task check`.
- **Errores:** quedan en la tabla `errores` y te llega una línea por privado. Tu hermano nunca ve detalles técnicos.
- **Proyecto en pausa:** Supabase pausa los proyectos gratuitos que pasan una semana sin actividad. Con el bot en uso no
  debería pasar; si pasa, se reactiva desde el panel.

## Rotar claves

Después de cambiar cualquier valor en `.env.local`: `npx supabase secrets set --env-file .env.local`.

| Clave                        | Cómo                                                                                           |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN`         | BotFather → `/revoke`. Pega el nuevo token y corre `deno task webhook`.                        |
| `TELEGRAM_WEBHOOK_SECRET`    | `deno task secreto`, `secrets set` y `deno task webhook`.                                      |
| `GOOGLE_SA_PRIVATE_KEY`      | Crea una clave nueva en la cuenta de servicio, cámbiala y borra la vieja.                      |
| `GOOGLE_OAUTH_REFRESH_TOKEN` | Quita el acceso en <https://myaccount.google.com/connections> y corre `deno task oauth-drive`. |
| `GEMINI_API_KEY`             | Crea una nueva en Google AI Studio y borra la vieja.                                           |
| Claves de Supabase           | Se rotan en el panel. Las funciones las reciben solas.                                         |

## Semillas

`semillas/` trae una primera versión armada con lo que se sabe de la obra (fechas, hitos de 900.000, H1 con 200.000 de
descuento, H3 el sáb 21 nov, caja menor de 100.000, festivos). Son **borrador** y hay que revisarlos contra los
documentos reales:

- `Tareas.csv`: 41 tareas + Z1–Z3 armadas a partir del alcance. Reemplázalas con el cronograma v5.
- `fotos_antes.json`: catálogo F01–F24 con encuadre, tareas e hitos. Sirve como guía para tomar las fotos.
- `Presupuesto.csv`: solo el albañil tiene valor. Los demás capítulos están vacíos.
- `Config.csv`: `compra_sin_factura_max = 50.000` es un valor sugerido.
- `Pagos.csv`: el anticipo de 200.000 al albañil, sin fecha.
- `facturas_esperadas.csv`: vacío hasta la fase 2.
