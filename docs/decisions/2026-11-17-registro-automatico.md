# Registro automático de gastos: notificaciones, no conexión al banco

**Fecha:** 2026-11-17 · **Estado:** implementado (`/api/ingest`) · **Guía de uso:** [`docs/AUTO_INGEST.md`](../AUTO_INGEST.md)

## Problema

Registrar cada gasto a mano es la fricción que hace abandonar una app de
finanzas. El objetivo es que los consumos con tarjeta entren solos. Había tres
vías sobre la mesa:

1. Atajos de iOS disparados por Apple Pay.
2. Los correos de notificación que el banco ya envía por cada consumo.
3. Leer las transacciones directamente del internet/mobile banking.

## Opciones evaluadas

| Vía | Cobertura | Latencia | Costo / riesgo | Veredicto |
|-----|-----------|----------|----------------|-----------|
| **Atajo «Transacción» (Apple Pay)** | Solo pagos hechos con el iPhone | Segundos | Cero infraestructura; datos ya estructurados | ✅ Implementado |
| **Correo del banco** | Todo consumo de la tarjeta (física, en línea, Apple Pay) | Segundos–minutos | Hay que interpretar texto libre por banco | ✅ Implementado |
| **API de open banking del banco** | — | — | No hay API de consumo para clientes individuales en RD | ❌ No disponible hoy |
| **Agregador (Plaid, Belvo, Prometeo…)** | — | — | Sin cobertura verificada de bancos dominicanos; de pago y con contrato | ❌ No disponible hoy |
| **Scraping del internet banking / app móvil** | Total | Minutos | Guardar usuario, clave y token del banco; viola términos de uso; se rompe con cada rediseño | ❌ Descartado |
| **Estado de cuenta en PDF** | Total, con un mes de retraso | Mensual | Ya existe (`/api/parse-pdf`) | ✅ Complemento para conciliar |

### Sobre el acceso directo de lectura al banco

Investigado el 2026-11-17. Conclusiones:

- **Regulación.** Las finanzas abiertas en República Dominicana siguen en
  desarrollo: la Superintendencia de Bancos, Adofintech y el Hub de Innovación
  Financiera las impulsan en foros, pero no existe todavía un marco que obligue a
  los bancos a exponer las transacciones de un cliente a un tercero autorizado.
  Lo publicado hasta ahora (tasas, tipos de cambio, validación de cuentas) no
  incluye movimientos de tarjeta.
- **Agregadores.** Open Banking Tracker lista **cero** agregadores con cobertura
  en el país. No se encontró evidencia de que Plaid, Belvo o Prometeo conecten
  bancos dominicanos. (No se confirmó con cada proveedor; revisar si cambia.)
- **Scraping / ingeniería inversa de la app.** Técnicamente posible, pero exige
  que FinTrack almacene las credenciales bancarias y resuelva el segundo factor
  en cada sesión. Un fallo de seguridad dejaría expuesta la cuenta del banco, no
  solo los datos de la app; además contraviene los términos de uso del banco y
  puede terminar en bloqueo de la cuenta. El riesgo no guarda proporción con el
  beneficio para una app personal.

La notificación de consumo **es** el canal de solo lectura que el banco ya
ofrece: llega por cada transacción, no requiere credenciales y el usuario
controla exactamente qué se reenvía. Por eso se construyó sobre ella.

**Cuándo reabrir esto:** si la Superintendencia de Bancos publica la normativa de
finanzas abiertas, o si un agregador anuncia cobertura de los bancos que usa el
usuario. El endpoint ya está preparado: una tercera fuente solo tiene que
producir `{ amount, merchant, last4, date }` y pasar por `buildIngestTransaction`.

## Decisiones de diseño

### Un endpoint, dos formas de entrada

`/api/ingest` acepta campos estructurados (Apple Pay) o `text` crudo (correo,
SMS). Ambos convergen en la misma función pura, `buildIngestTransaction`, que
reutiliza la inteligencia que la app ya tenía: `suggestFromHistory` (memoria de
transacciones), `autoCategorize` (palabras clave) y `computeCashback`. Un gasto
automático se categoriza exactamente igual que uno manual.

### Token personal en vez de sesión

Un Atajo no puede hacer el flujo OAuth/PKCE de Supabase ni refrescar un JWT.
Se usa un token de larga vida al estilo de los *personal access tokens*:

- generado en el navegador (256 bits), mostrado una sola vez;
- en la base solo se guarda su SHA-256 (`ingest_tokens.token_hash`);
- alcance mínimo: el endpoint solo **crea** gastos y no devuelve datos del usuario.

Con 256 bits aleatorios un hash rápido basta (no hay diccionario que atacar), y
permite buscar el token con un índice único en vez de comparar contra todos.

### `service_role` acotada

Quien llama no tiene sesión, así que el endpoint usa la `service_role` key (como
el cron de recordatorios). Mitigaciones: falla cerrado sin la variable de
entorno, toda consulta filtra por el `user_id` resuelto del token, y la
escritura pasa por una única función SQL.

### Deduplicación atómica en SQL

El caso típico es una carrera: el toque de Apple Pay y el correo del banco
llegan con segundos de diferencia. Un «consultar y luego insertar» desde el
endpoint dejaría pasar ambos. `ingest_transaction` toma un *advisory lock* por
usuario y decide dentro de la misma transacción:

- mismo monto y fecha desde **otro** canal automático en 48 h → duplicado;
- mismo monto y fecha desde el **mismo** canal en 2 min → duplicado (reintento).

Se descartó una restricción `UNIQUE` porque dos compras idénticas el mismo día
son legítimas (dos pasajes, dos cafés). No se deduplica contra registros
manuales por la misma razón: la app no puede saber si son el mismo gasto.

La función también aplica el límite de 60 registros automáticos por hora:
`check_rate_limit` no sirve aquí porque depende de `auth.uid()`, que es nulo con
`service_role`.

### Los correos no se almacenan

El cuerpo del correo se procesa en memoria y se descarta; tampoco se escribe en
los logs de error. Solo persisten monto, comercio, fecha y tarjeta. Guardar el
correo crudo facilitaría depurar el lector, pero convertiría la base en un
archivo de correspondencia bancaria.

### Moneda extranjera: marcar, no convertir

La app es de moneda única y no tiene tasas de cambio. Convertir a ciegas daría
un número falso con apariencia de exacto; descartar el consumo lo ocultaría. Se
registra el monto original con una nota visible para que el usuario lo corrija.

## Verificación

- **Unitarias (Vitest):** `ingestParser.test.js`, `ingestBuild.test.js`,
  `ingestToken.test.js` — formatos de monto por región, clasificación de mensajes
  (consumo / rechazo / reverso / OTP / pago / promoción), asignación de tarjeta,
  prioridad historial > palabras clave, moneda extranjera.
- **SQL:** migración y `schema.sql` aplicados dos veces sobre PostgreSQL 16
  (idempotencia); probados duplicado entre canales, reintento, límite por hora,
  aislamiento entre usuarios y que `authenticated`/`anon` no pueden ejecutar la
  función ni modificar tokens ajenos.
- **Endpoint:** códigos de respuesta recorridos con la API de Supabase simulada.

## Deuda conocida

- El lector de correos se probó con mensajes **sintéticos**. Falta calibrarlo
  con correos reales (anonimizados) de cada banco y fijarlos como casos de prueba.
- No hay prueba de integración del endpoint contra un Supabase real en CI.
- Los pasos del Atajo no se pudieron ejecutar en un dispositivo desde el entorno
  de desarrollo; los nombres de los campos de «Entrada del atajo» pueden variar
  según la versión de iOS.
