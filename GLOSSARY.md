# FinTrack

PWA de finanzas personales: presupuesto base cero, ciclos de tarjetas, ahorros, deudas y proyección del dinero disponible. Este glosario fija el lenguaje del dominio; hoy solo cubre los términos de la feature «Dinero real y proyección» (`docs/specs/2026-11-20-dinero-real-y-proyeccion.md`).

## Dinero disponible

**Efectivo líquido**:
Saldo derivado de la cuenta de banco: saldo inicial + ingresos − gastos sin tarjeta (netos de cashback) − apartados a ahorro − abonos a tarjeta. Los gastos con tarjeta no lo mueven hasta que se registra el abono.
_Evitar_: saldo, balance, disponible

**Dinero real**:
Efectivo líquido menos el saldo pendiente de todas las tarjetas. Es lo que queda si hoy se pagaran las tarjetas completas. No incluye ahorro ni préstamos.
_Evitar_: dinero total, patrimonio, neto

**Mi dinero total**:
Cifra del hero del Resumen: efectivo líquido + ahorro − facturado pendiente. Es distinta del dinero real.
_Evitar_: dinero real, patrimonio neto (ese nombre lo usa «Mis finanzas» con otra regla)

**Faltante**:
Lo que falta para cubrir un pago con el efectivo disponible en ese momento: `max(0, monto − disponible)`.
_Evitar_: déficit, hueco

## Tarjetas de crédito

**Saldo pendiente de tarjeta**:
Todo lo que se debe hoy en una tarjeta: facturado pendiente + ciclo abierto − abonos, con mínimo 0.
_Evitar_: deuda de tarjeta, balance

**Facturado pendiente**:
Parte del saldo ya cortada en un estado de cuenta y aún sin pagar (incluye lo arrastrado).
_Evitar_: tarjetas por pagar (rótulo de UI, no término de dominio), saldo

**Ciclo abierto**:
Consumos de la tarjeta posteriores al último corte, que todavía no aparecen en un estado de cuenta.
_Evitar_: consumo nuevo, período actual

**Abono**:
Pago registrado a una tarjeta (`card.payments`). Es el momento en que el efectivo sale del banco.
_Evitar_: pago de tarjeta (ambiguo con el pago completo previsto)

**Pago completo de tarjeta**:
Pago previsto, en la fecha de pago, por todo el saldo del estado de cuenta correspondiente. Supone que nunca se paga el mínimo.
_Evitar_: pago mínimo, cuota

## Proyección

**Proyección**:
Curva estimada del dinero real a 12 meses según un escenario. Es solo una simulación y nunca modifica datos.
_Evitar_: pronóstico, presupuesto

**Escenario**:
Juego de supuestos de la proyección: «como vas», «solo lo esencial» o «con recortes».
_Evitar_: plan, modo

**Gasto variable base**:
Gasto variable mensual que asume la proyección: el promedio de los últimos 3 meses completos o una corrección manual.
_Evitar_: promedio de gasto, gasto estimado

**Ingreso restringido**:
Ingreso que solo se puede gastar en un comercio o rubro concreto (p. ej. un bono de supermercado). No es efectivo líquido.
_Evitar_: bono, ingreso extra
