/**
 * Captura las imágenes del README desde la app real.
 *
 * Levanta el build de producción (`vite preview`) y recorre las pantallas en
 * "modo demo" —los datos de ejemplo viven en memoria, no toca Supabase ni
 * producción—, así que las capturas siempre reflejan el código de este commit
 * y se pueden regenerar de un tirón:
 *
 *   npm run build && npm run screenshots
 *
 * Variables opcionales:
 *   PLAYWRIGHT_CHROMIUM_PATH  Chromium ya instalado en el sistema.
 *   HTTPS_PROXY               Proxy de salida (ver routeExternalThroughProxy).
 */
import { chromium, request as pwRequest } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const isWindows = process.platform === 'win32';

const PORT = 4179;
const BASE_URL = `http://localhost:${PORT}`;
const OUT_DIR = fileURLToPath(new URL('../docs/screenshots/', import.meta.url));
const DESKTOP = { width: 1440, height: 960 };
const MOBILE = { width: 414, height: 896 };

// Pantallas a capturar. `prepare` corre ya dentro de la pantalla, justo antes
// de disparar la captura (p. ej. para elegir una pestaña concreta).
const SHOTS = [
  { name: 'landing', path: '/', viewport: DESKTOP, demo: false },
  { name: 'dashboard', path: '/', viewport: DESKTOP },
  {
    name: 'budget',
    path: '/presupuesto',
    viewport: DESKTOP,
    // El nivel por defecto es Seguimiento; base cero es lo que vale la pena enseñar.
    prepare: async (page) => {
      await page.getByRole('button', { name: /Base cero/i }).click();
      await page.getByText(/Por asignar/i).first().waitFor({ timeout: 10_000 });
    },
  },
  { name: 'transactions', path: '/transacciones', viewport: DESKTOP },
  { name: 'finances', path: '/mis-finanzas', viewport: DESKTOP },
  { name: 'calendar', path: '/calendario', viewport: DESKTOP },
  {
    name: 'projection',
    path: '/proyeccion',
    viewport: DESKTOP,
    // La curva se dibuja tras montar la pantalla: espera al título antes de capturar.
    prepare: async (page) => {
      await page.getByRole('heading', { level: 1, name: /Proyección/i }).waitFor({ timeout: 10_000 });
    },
  },
  { name: 'dashboard-mobile', path: '/', viewport: MOBILE },
];

const proxyServer = process.env.HTTPS_PROXY || process.env.https_proxy;

// Detrás de un proxy MITM, Chromium suele quedarse sin los CONNECT a Google
// Fonts (los iconos de Material Symbols saldrían como texto: "dashboard",
// "logout"...), mientras que el cliente HTTP de Playwright sí atraviesa. Cuando
// hay proxy, resolvemos las peticiones externas desde Node y las inyectamos en
// la página; sin proxy no se intercepta nada.
const api = proxyServer
  ? await pwRequest.newContext({ proxy: { server: proxyServer }, ignoreHTTPSErrors: true })
  : null;

async function routeExternalThroughProxy(context) {
  if (!api) return;
  await context.route(/^https:\/\//, async (route) => {
    const req = route.request();
    try {
      const res = await api.fetch(req.url(), {
        method: req.method(),
        // El User-Agent decide si Google Fonts devuelve woff2 o ttf.
        headers: req.headers(),
      });
      const headers = { ...res.headers() };
      // El body ya viene decodificado; dejar estas cabeceras rompe el fulfill.
      delete headers['content-encoding'];
      delete headers['content-length'];
      await route.fulfill({ status: res.status(), headers, body: await res.body() });
    } catch {
      await route.abort();
    }
  });
}

async function waitForServer(url, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // aún no levanta
    }
    await sleep(500);
  }
  throw new Error(`El preview no respondió en ${url}`);
}

/** Quita el aviso de "faltan variables de Supabase", que taparía la captura. */
async function dismissEnvNotice(page) {
  const hide = page.getByRole('button', { name: 'Ocultar' });
  if (await hide.isVisible().catch(() => false)) await hide.click();
}

/** Entra en modo demo desde la landing y espera al dashboard. */
async function enterDemo(page) {
  await page.getByRole('button', { name: /Ver demo/i }).click();
  await page.locator('[data-tour="dashboard-grid"]').waitFor({ timeout: 20_000 });
  // El tutorial se abre solo sobre el dashboard y taparía la captura.
  const skip = page.getByText('Saltar tutorial');
  await skip.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
  if (await skip.isVisible().catch(() => false)) {
    await skip.click();
    await skip.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});
  }
}

// npm lanza vite en un nieto, así que hay que matar al árbol completo o el
// preview se queda escuchando en el puerto y la siguiente ejecución falla. En
// POSIX eso es un grupo propio (detached + kill al -pid); en Windows no existen
// los grupos de proceso, se resuelve con `taskkill /T`.
//
// `shell` en Windows no es opcional: ahí npm es un .cmd y, desde la corrección
// de CVE-2024-27980, Node se niega a lanzar archivos por lotes sin shell
// (spawn('npm') da ENOENT y spawn('npm.cmd') da EINVAL).
// (Con shell, el comando va como una sola cadena: pasar además un array de
// args solo concatena sin escapar, y Node avisa de ello — DEP0190.)
const previewArgs = ['run', 'preview', '--', '--port', String(PORT), '--strictPort'];
const preview = isWindows
  ? spawn(`npm ${previewArgs.join(' ')}`, { stdio: 'inherit', shell: true })
  : spawn('npm', previewArgs, { stdio: 'inherit', detached: true });

// spawn emite 'error' de forma asíncrona (ENOENT, permisos...). Sin handler el
// proceso muere por un 'error' no capturado y el mensaje real queda enterrado.
preview.on('error', (err) => {
  console.error(`No se pudo arrancar \`npm run preview\`: ${err.message}`);
  process.exit(1);
});

function stopPreview() {
  if (preview.exitCode !== null || preview.signalCode !== null) return;
  if (isWindows) {
    spawn('taskkill', ['/pid', String(preview.pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  try {
    process.kill(-preview.pid, 'SIGTERM');
  } catch {
    preview.kill('SIGTERM');
  }
}

try {
  await waitForServer(BASE_URL);
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
  });

  for (const { name, path, viewport, demo = true, prepare } of SHOTS) {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: 2,
      locale: 'es-DO',
      // Sin animaciones de entrada las capturas salen con todo ya montado.
      reducedMotion: 'reduce',
    });
    await routeExternalThroughProxy(context);

    const page = await context.newPage();
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await dismissEnvNotice(page);

    if (demo) {
      await enterDemo(page);
      if (path !== '/') {
        await page.goto(BASE_URL + path, { waitUntil: 'networkidle' });
      }
      if (prepare) await prepare(page);
    }

    // Las fuentes de iconos deben estar cargadas o los <span> de Material
    // Symbols se capturan como texto; luego, margen para los PNG de emoji y el
    // dibujado de los gráficos.
    await page.evaluate(() => document.fonts.ready);
    await sleep(2500);

    await page.screenshot({ path: join(OUT_DIR, `${name}.png`) });
    console.log(`✓ ${name}.png`);
    await context.close();
  }

  await browser.close();
} catch (err) {
  // Sin esto el script termina con código 0 aunque no haya capturado nada, y
  // tanto CI como quien lo corre a mano se lo tragan como un éxito.
  console.error(err);
  process.exitCode = 1;
} finally {
  await api?.dispose();
  stopPreview();
}
