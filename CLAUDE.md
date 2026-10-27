# Bot de obra – Apto 202 Los Andes

Prompt completo: `Los Andes/07 App de reportes/PROMPT - bot de obra para Claude Code.md` (Drive).

## Cómo trabajar con Carlos

- Ingeniero electrónico: Python, SQL, React/Vite y Supabase. Explicar lo necesario, sin rodeos.
- Construir por fases (README). Al terminar cada fase: parar, dar la lista de pruebas y esperar su OK.
- Pasos manuales (cuentas, claves, grupo de Telegram): los hace él, un paso a la vez, esperando confirmación.
- Secretos nunca en código, chat ni logs: solo `.env.local` y `supabase secrets set`.
- Revisar la documentación vigente de cada API antes de escribir su cliente.
- Textos al usuario en español de Colombia, frases cortas. Identificadores de código en inglés; los nombres de tablas,
  columnas y claves siguen exactamente al prompt y a `semillas/`.
- No agregar funciones que no estén en el prompt. Si algo es ambiguo, preguntar.

## Carpeta «Los Andes» en el Drive de Carlos

Id de la carpeta: `1BCKlIiVjK5XNfI5StWezKxfE1V9b9Obf`. Se lee con el conector de Google Drive.

```
Los Andes/
├── 01 Fotos y video/                 recorrido y fotos del estado actual (sep–oct 2026)
│   ├── 00 Recorrido completo - video (2026-09-28).mp4
│   ├── 01 Sala-comedor - vista hacia la ventana (2026-09-28).jpg
│   ├── 02 Sala-comedor - panorámica 360 (2026-09-28).jpg
│   ├── 03 Sala-comedor - panorámica hacia ventana y cocina (2026-09-28).jpg
│   ├── 04 Sala-comedor - muro con nicho y paso a la cocina (2026-10-01).jpg
│   ├── 05 Sala-comedor - paso a la cocina, puerta principal y pasillo (2026-10-01).jpg
│   └── Antes - estado original (F01-F24)/        vacía (el catálogo quedó en 13 fotos el 27 oct)
├── 02 Planos/
│   ├── Plano aproximado v5 - vigente (2026-10-22).pdf / .png
│   ├── Bocetos y referencias/        boceto a mano: planta general; cocina y área de labores
│   └── Versiones anteriores/         planos v1–v4
├── 03 Cronograma/
│   ├── Cronograma v5 - vigente (2026-10-22).pdf / .png
│   └── Versiones anteriores/         cronogramas v1–v4
├── 04 Documentos/                    los vigentes son Google Docs del 27 oct
│   ├── Plan de acción - Remodelación apto Los Andes (2026-10-27)
│   ├── Manual del maestro de obra (2026-10-27)
│   ├── App de reportes de obra - cómo quedó el bot (2026-10-27)
│   ├── Guía del bot de obra (2026-10-27)          uso del bot y rutina diaria del hermano
│   ├── Triple A - tickets de reclamo (2026-10-19).txt
│   ├── Triple A - nota de tickets en la pared (2026-10-19).jpg
│   └── Versiones anteriores/         los PDF del 22 oct (plan, manual y diseño de la app)
├── 05 Facturas y pagos/
│   ├── Facturas/                     las 4 facturas reales (fase 2)
│   │   ├── 2026-09-22 Easy EL021045207 - baños, grifería, lavaplatos y estufa - 1.834.030.pdf
│   │   ├── 2026-09-30 Easy EL021045523 - enchapes, sanitario, eléctricos - 2.703.886.pdf
│   │   ├── 2026-10-19 Homecenter 5209100261757 - viga de acero 90x50, corte y pino - 215.700.pdf
│   │   └── 2026-10-20 Homecenter 5212100268554 - transporte - 19.900.pdf
│   └── Pagos/                        vacía
├── 06 Cotizaciones/                  vacía
├── 07 App de reportes/
│   ├── PROMPT - bot de obra para Claude Code.md   diseño inicial (los cambios están en «App de reportes … cómo quedó»)
│   ├── Obra Los Andes – datos        la hoja del bot
│   ├── Test app/
│   └── semillas/                     copia de semillas/ de este repo (versiones viejas en «Versiones anteriores»)
└── LÉEME - cambios del 27 oct 2026   qué cambió ese día, para leerlo y descargarlo
```

Ids útiles:

| Qué                            | Id                                  |
| ------------------------------ | ----------------------------------- |
| `05 Facturas y pagos/Facturas` | `1bn3CSmEjcBvb_ffPcPvf7noZe-2pNAbW` |
| `07 App de reportes/semillas`  | `1MFYT7bvOFM3U4F1xrz2aMIRd1MxO2YnR` |
| `03 Cronograma`                | `1c4ZjGseVXFuacvJlhKK4SymTvDBwo9uH` |
| `01 Fotos y video`             | `1G2ZpcBYFgtX1eBjcCnQtSb57AebYNtTs` |
| `04 Documentos`                | `1Zqkqt1rxytmbDZF9Zr4FlA03sfrsS9dT` |

Las fotos de referencia «foto 04», «foto 06» del catálogo (`semillas/fotos_antes.json`, 13 de las F01–F24) se refieren a
`01 Fotos y video/` (hoy solo hay 00–05).

El bot no escribe en esta carpeta: crea la suya, `Obra Los Andes/`, con permiso `drive.file`.
