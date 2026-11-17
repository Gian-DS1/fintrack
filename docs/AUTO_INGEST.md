# Registro automático de gastos

FinTrack puede registrar tus consumos **sin que abras la app**. Dos canales, un
solo endpoint (`POST /api/ingest`):

| Canal | Qué lo dispara | Qué envía | Latencia |
|-------|----------------|-----------|----------|
| **Apple Pay** | Automatización de Atajos «Transacción» al pagar con el iPhone | Monto, comercio y tarjeta ya estructurados | Segundos |
| **Correo del banco** | Automatización de Atajos «Correo», o un script de Gmail | El cuerpo del correo; el servidor extrae monto, comercio, tarjeta y fecha | Segundos a minutos |

Si un mismo pago llega por los dos canales (tocas con Apple Pay **y** el banco te
manda el correo), se registra **una sola vez**.

> Por qué notificaciones y no una conexión directa al banco: ver
> [la decisión de diseño](decisions/2026-11-17-registro-automatico.md).

---

## 1. Requisitos (una sola vez)

1. **Base de datos:** corre [`supabase/add_auto_ingest.sql`](../supabase/add_auto_ingest.sql)
   en el SQL Editor de Supabase (idempotente).
2. **Vercel:** la variable `SUPABASE_SERVICE_ROLE_KEY` debe existir en el
   proyecto (es la misma que ya usan los recordatorios por correo). Sin ella el
   endpoint responde `503` y no registra nada.
3. **Token:** en la app, *Ajustes → Registro automático → Generar token*.
   Cópialo en ese momento: no se vuelve a mostrar. Un token por dispositivo.
4. **(Recomendado) Últimos 4 dígitos:** edita cada tarjeta en *Mis finanzas →
   Tarjetas* y completa «Últimos 4 dígitos». Es lo que permite asignar a la
   tarjeta correcta los consumos que llegan por correo.

## 2. Apple Pay (Atajos de iOS 17 o superior)

1. App **Atajos → Automatización → +**.
2. Elige **Transacción** (en iOS 26 aparece como **Wallet**). Marca las tarjetas
   a seguir y **Ejecutar inmediatamente** (sin «Preguntar antes de ejecutar»).
3. **Nueva automatización en blanco** → agrega la acción **Obtener contenido de URL**:

   | Campo | Valor |
   |-------|-------|
   | URL | `https://fintrack-rd.vercel.app/api/ingest` |
   | Método | `POST` |
   | Encabezados | `Authorization` = `Bearer ft_…tu_token…` |
   | Cuerpo de la solicitud | `JSON` |
   | ↳ `amount` (Texto) | *Entrada del atajo* → **Importe** |
   | ↳ `merchant` (Texto) | *Entrada del atajo* → **Comercio** |
   | ↳ `card` (Texto) | *Entrada del atajo* → **Tarjeta o pase** |

4. *(Opcional)* Para ver la confirmación: **Obtener valor del diccionario**
   (clave `message`) → **Mostrar notificación**. Verás algo como
   `Registrado: RD$1,250.00 · Supermercados Nacional · Supermercado · MC CCN Plus`.

**Límites del disparador (son de iOS, no de FinTrack):** solo se activa con pagos
hechos desde ese iPhone; los pagos en la web, en un Mac o un iPad no lo disparan.
Las compras con la tarjeta física tampoco: para esas está el canal del correo.

**Cómo se asigna la tarjeta:** el nombre que da Wallet se compara con el nombre
de tus tarjetas en FinTrack (y con sus últimos 4 dígitos si el nombre los trae).
Si no coincide con ninguna, el gasto queda **sin tarjeta** (se asume débito).
Si Wallet la llama distinto, renómbrala en FinTrack o envía un texto fijo en `card`.

## 3. Correos de notificación del banco

Activa primero las alertas de consumo por correo en tu banco. Luego elige **una**
de estas dos opciones (usar ambas no duplica, pero no aporta).

### Opción A — Atajo de iOS (sin infraestructura extra)

1. **Atajos → Automatización → + → Correo**. En **Remitente** pon la dirección
   desde la que tu banco envía las alertas. **Ejecutar inmediatamente**.
2. Acción **Obtener contenido de URL**, igual que en Apple Pay pero con este cuerpo:

   | Clave | Valor |
   |-------|-------|
   | `text` (Texto) | *Entrada del atajo* → contenido/cuerpo del correo |
   | `source` (Texto) | `email` |

Requiere que la cuenta esté configurada en la app **Mail** de iOS. Con Gmail, Mail
no recibe *push* sino que consulta cada cierto tiempo, así que el registro puede
tardar varios minutos.

> El mismo cuerpo (`text`) sirve con el disparador **Mensaje** si tu banco
> notifica por SMS.

### Opción B — Script de Gmail (no depende del teléfono)

Corre en los servidores de Google cada 5 minutos, aunque el iPhone esté apagado.

1. Abre <https://script.google.com> → **Nuevo proyecto** y pega:

   ```js
   const ENDPOINT = 'https://fintrack-rd.vercel.app/api/ingest';
   // Remitentes de las alertas de tus bancos (ajústalos a los tuyos).
   const QUERY = 'from:(alertas@tubanco.com OR notificaciones@otrobanco.com) newer_than:2d -label:fintrack';

   function syncBankEmails() {
     const token = PropertiesService.getScriptProperties().getProperty('FINTRACK_TOKEN');
     const label = GmailApp.getUserLabelByName('fintrack') || GmailApp.createLabel('fintrack');
     GmailApp.search(QUERY, 0, 20).forEach((thread) => {
       const allSent = thread.getMessages().every((message) => {
         const res = UrlFetchApp.fetch(ENDPOINT, {
           method: 'post',
           contentType: 'application/json',
           headers: { Authorization: 'Bearer ' + token },
           payload: JSON.stringify({ text: message.getPlainBody(), source: 'email' }),
           muteHttpExceptions: true,
         });
         // 2xx = registrado, duplicado u omitido. 422 = correo sin monto: tampoco
         // se reintenta. Cualquier otro código (429, 5xx) se reintenta luego.
         const code = res.getResponseCode();
         return (code >= 200 && code < 300) || code === 422;
       });
       if (allSent) thread.addLabel(label);
     });
   }
   ```

2. **Configuración del proyecto → Propiedades de la secuencia de comandos** →
   agrega `FINTRACK_TOKEN` con tu token (no lo pegues en el código).
3. **Activadores → Añadir activador** → función `syncBankEmails`, basado en
   tiempo, cada 5 minutos. Autoriza el acceso a Gmail cuando lo pida.

La etiqueta `fintrack` marca los correos ya procesados, así que cada uno se envía
una sola vez.

## 4. Probar sin teléfono

```bash
curl -X POST https://fintrack-rd.vercel.app/api/ingest \
  -H "Authorization: Bearer ft_tu_token" \
  -H "Content-Type: application/json" \
  -d '{"amount":"RD$150.00","merchant":"Prueba","card":""}'
```

Los gastos automáticos aparecen en *Transacciones* con un ícono junto a la
descripción (contactless = Apple Pay, sobre = correo). Edítalos o bórralos como
cualquier otro.

---

## Referencia de la API

`POST /api/ingest` · `Authorization: Bearer <token>` · cuerpo JSON:

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `amount` | texto o número | Monto. Acepta `1250`, `"RD$1,250.00"`, `"12,50 €"`. Obligatorio si no hay `text`. |
| `merchant` | texto | Comercio; se usa como descripción. |
| `card` | texto | Nombre de la tarjeta (Wallet). |
| `last4` | texto | Últimos 4 dígitos, si los conoces. |
| `date` | texto | `AAAA-MM-DD` o `dd/mm/aaaa`. Por defecto, hoy (zona `REMINDER_TIMEZONE`). |
| `text` | texto | Cuerpo crudo de un correo/SMS del banco (HTML o texto, máx. 50 000 caracteres). |
| `source` | texto | `shortcut` o `email`. Si falta: `shortcut` cuando hay `amount`, `email` cuando solo hay `text`. |

| Respuesta | Significado |
|-----------|-------------|
| `201 { status: "created" }` | Gasto registrado. |
| `200 { status: "duplicate" }` | Ya estaba registrado (otro canal o reintento). |
| `200 { status: "skipped", reason }` | El mensaje no es un consumo: rechazo, reverso, código OTP, pago a la tarjeta, depósito o promoción. |
| `401` | Token ausente, inválido o revocado. |
| `422` | No se encontró un monto. |
| `429` | Más de 60 registros automáticos en la última hora. |
| `503` | Falta la migración o `SUPABASE_SERVICE_ROLE_KEY`. |

Todas las respuestas `2xx` traen un `message` legible para mostrarlo en una notificación.

## Cómo decide categoría, tarjeta y duplicados

- **Categoría:** primero tu historial (lo que elegiste antes para ese comercio),
  luego las palabras clave de tus categorías. Es la misma lógica del formulario
  manual. Sin coincidencia queda sin categoría para que la asignes tú.
- **Tarjeta:** últimos 4 dígitos → nombre → (solo si no llegó ninguna pista) la
  que sueles usar en ese comercio. El cashback de la tarjeta se calcula igual
  que en un registro manual.
- **Duplicados:** mismo monto y misma fecha por *otro* canal automático en 48 h,
  o por el *mismo* canal en 2 minutos. Dos compras iguales el mismo día por el
  mismo canal (dos pasajes) sí se registran.
- **Otra moneda:** FinTrack no maneja tasas de cambio. Un consumo en una moneda
  distinta a la de tu perfil se registra con el monto original y una nota
  «⚠ Monto original en USD, sin convertir» para que lo corrijas.

## Limitaciones conocidas

- **El lector de correos es genérico.** Reconoce patrones comunes («Monto:»,
  «Comercio:», «por RD$… en COMERCIO», «terminada en 1234») y está probado con
  mensajes sintéticos, no con correos reales de cada banco. Si un correo real no
  se registra bien, agrégalo (anonimizado) como caso en
  `src/utils/ingestParser.test.js` y ajusta el patrón.
- Las fechas `dd/mm` ambiguas se leen en formato local (día primero).
- Los gastos automáticos aparecen en la app al recargarla o al volver a ella
  (se refrescan como mucho una vez por minuto).

## Seguridad

- El token solo permite **crear gastos**; no puede leer, editar ni borrar datos.
- En la base se guarda el **SHA-256** del token, nunca el token. Se genera en tu
  navegador con 256 bits de entropía.
- Revocar un token en Ajustes lo invalida al instante.
- El cuerpo de los correos se procesa en memoria: **no se guarda ni se loguea**.
- Si pierdes el teléfono o compartes un atajo por error: revoca el token.
  ⚠️ Un atajo exportado o compartido incluye el token en texto plano.
