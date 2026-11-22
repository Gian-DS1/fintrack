import { test, expect } from '@playwright/test';
import { openLanding, enterDemo, skipTour } from './helpers';

// E2E de la pantalla «Proyección» en modo demo (datos sembrados, sin Supabase).
// Cubre: llegar desde el Resumen y desde el menú, el aviso de simulación, el
// selector de escenario y los interruptores con teclado, que lo simulado se guarda
// en el dispositivo sin tocar los datos, la tabla alternativa y que a 375 px no hay
// scroll horizontal.

async function abrirProyeccion(page) {
  await openLanding(page);
  await enterDemo(page);
  await skipTour(page);
  await page.getByRole('link', { name: 'Ver proyección' }).click();
  await expect(page).toHaveURL(/\/proyeccion$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Proyección a 12 meses' })).toBeVisible();
}

const sobranteHorizontal = (page) => page.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
);

test.describe('Pantalla Proyección (modo demo)', () => {
  test('se llega desde «Dinero real» y muestra el aviso de simulación y la curva', async ({ page }) => {
    await abrirProyeccion(page);

    await expect(page.getByText('Simulación: nada de lo que cambies aquí modifica tus datos.')).toBeVisible();
    await expect(page.getByRole('img', { name: /Gráfico del dinero real a 12 meses/ })).toBeVisible();
    // Con los datos del demo (ingresos recurrentes sembrados) no hay aviso de «sin ingresos».
    await expect(page.getByText(/No hay ingresos recurrentes/)).toHaveCount(0);
    // El veredicto se comunica con texto.
    await expect(page.getByText(/En 12 meses tendrías|pasa a negativo|ya está en negativo/)).toBeVisible();
  });

  test('también está en el menú de navegación', async ({ page }) => {
    await openLanding(page);
    await enterDemo(page);
    await skipTour(page);
    await page.locator('[data-tour="nav"]').getByRole('link', { name: 'Proyección' }).click();
    await expect(page).toHaveURL(/\/proyeccion$/);
    await expect(page).toHaveTitle(/Proyección · FinTrack/);
  });

  test('el selector de escenario funciona con teclado y «Con recortes» muestra el recorte', async ({ page }) => {
    await abrirProyeccion(page);

    const actual = page.getByRole('button', { name: 'Como vas' });
    const recortes = page.getByRole('button', { name: 'Con recortes' });
    await expect(actual).toHaveAttribute('aria-pressed', 'true');

    await recortes.focus();
    await page.keyboard.press('Enter');
    await expect(recortes).toHaveAttribute('aria-pressed', 'true');
    await expect(actual).toHaveAttribute('aria-pressed', 'false');

    const recorte = page.getByRole('slider', { name: /Recorte del gasto variable/ });
    await expect(recorte).toHaveValue('20');
    await recorte.focus();
    await page.keyboard.press('ArrowRight');
    await expect(recorte).toHaveValue('25');
  });

  test('«Solo lo esencial» invita a elegir categorías y estas se pueden marcar con teclado', async ({ page }) => {
    await abrirProyeccion(page);
    await page.getByRole('button', { name: 'Solo lo esencial' }).click();

    await expect(page.getByText(/No marcaste ninguna categoría esencial/)).toBeVisible();
    const grupo = page.getByRole('group', { name: 'Categorías esenciales' });
    const primera = grupo.getByRole('checkbox').first();
    await primera.focus();
    await page.keyboard.press('Space');
    await expect(primera).toBeChecked();
    await expect(page.getByText(/No marcaste ninguna categoría esencial/)).toHaveCount(0);
  });

  test('un interruptor se apaga con teclado, muestra «+RD$/mes», se guarda en el dispositivo y no toca los datos', async ({ page }) => {
    await abrirProyeccion(page);

    const alquiler = page.getByRole('switch', { name: /Alquiler mensual/ });
    await expect(alquiler).toBeChecked();
    await alquiler.focus();
    await page.keyboard.press('Space');
    await expect(alquiler).not.toBeChecked();
    await expect(page.getByText(/\+RD\$\u00A032,000\/mes/)).toBeVisible();
    await expect(page.getByText(/Lo que apagaste libera/)).toBeVisible();

    // Los datos reales no cambiaron: la plantilla recurrente sigue activa.
    const todasActivas = await page.evaluate(() => {
      const raw = sessionStorage.getItem('fintrack-recurring-cache');
      const recurring = raw ? JSON.parse(raw).state.recurring : [];
      return recurring.length > 0 && recurring.every((r) => r.active);
    });
    expect(todasActivas).toBe(true);

    // La simulación sobrevive a una recarga (localStorage del dispositivo).
    await page.reload();
    await expect(page.getByRole('switch', { name: /Alquiler mensual/ })).not.toBeChecked();
  });

  test('los fijos no programados se pueden poner a 0 y la simulación se guarda con clave versionada por usuario', async ({ page }) => {
    await abrirProyeccion(page);

    const fijos = page.getByRole('switch', { name: /Incluir los fijos no programados/ });
    await expect(fijos).toBeChecked();
    await fijos.focus();
    await page.keyboard.press('Space');
    await expect(fijos).not.toBeChecked();

    const claves = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('fintrack-projection-simulation')));
    expect(claves).toEqual(['fintrack-projection-simulation:v1:demo']);
  });

  test('el gasto variable base se corrige a mano y se restablece', async ({ page }) => {
    await abrirProyeccion(page);

    await expect(page.getByText(/Promedio de \d+ mes/)).toBeVisible();
    const campo = page.getByLabel('Corregir el gasto variable no programado (al mes)');
    await campo.fill('10000');
    await expect(page.getByText('Usando tu valor manual en lugar del promedio.')).toBeVisible();

    await page.getByRole('button', { name: 'Restablecer' }).click();
    await expect(campo).toHaveValue('');
    await expect(page.getByText('Usando tu valor manual en lugar del promedio.')).toHaveCount(0);
  });

  test('la tabla alternativa está cerrada, se abre con teclado y lista el mes actual y 12 más', async ({ page }) => {
    await abrirProyeccion(page);

    const toggle = page.getByRole('button', { name: 'Ver los datos en tabla' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    const tabla = page.getByRole('table', { name: 'Dinero real proyectado al cierre de cada mes' });
    await expect(tabla).toBeVisible();
    // Cabecera + «Hoy» + 13 cierres de mes.
    await expect(tabla.getByRole('row')).toHaveCount(15);
  });

  test('con reduced-motion la curva se dibuja igual', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await abrirProyeccion(page);
    await expect(page.getByRole('img', { name: /Gráfico del dinero real/ }).locator('svg path.recharts-curve').first()).toBeVisible();
  });

  test('a 375 px no hay scroll horizontal, tampoco con la tabla y las categorías abiertas', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await abrirProyeccion(page);
    expect(await sobranteHorizontal(page)).toBeLessThanOrEqual(0);

    await page.getByRole('button', { name: 'Solo lo esencial' }).click();
    await page.getByRole('button', { name: 'Ver los datos en tabla' }).click();
    await expect(page.getByRole('table')).toBeVisible();
    expect(await sobranteHorizontal(page)).toBeLessThanOrEqual(0);
  });
});
