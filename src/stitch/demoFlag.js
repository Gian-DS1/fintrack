// Detección del modo demo/QA, aislada de demoMode.js a propósito.
//
// demoMode.js importa TODOS los stores (los siembra). Si los stores importaran
// de ahí `isDemoActive`, se cerraría un ciclo store -> demoMode -> store: el
// módulo a medio inicializar se resuelve distinto según quién llegue primero,
// y en pruebas un vi.mock de demoMode no alcanzaba a useTransactionStore, que
// se quedaba con la versión real (isDemoActive() === false).
//
// Este módulo no importa nada del proyecto, así que cualquiera puede leerlo sin
// crear ciclos. demoMode.js lo reexporta para no romper a sus consumidores.

const DEMO_FLAG = 'fintrack-demo-mode';
const FRESH_FLAG = 'fintrack-fresh-mode';

// El modo demo (QA) solo se habilita en localhost. NUNCA en producción: expone
// la app con datos sembrados sin autenticación, así que debe quedar fuera del
// despliegue público.
export function isLocalhost() {
  if (typeof window === 'undefined') return false;
  const h = window.location.hostname;
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
}

function flag(name) {
  try {
    return typeof sessionStorage !== 'undefined' && sessionStorage.getItem(name) === '1';
  } catch {
    // Modo privado o almacenamiento bloqueado: no hay demo que valga.
    return false;
  }
}

export function isDemoActive() {
  return isLocalhost() && (flag(DEMO_FLAG) || flag(FRESH_FLAG));
}

// Distingue el sub-modo "usuario nuevo" (cuenta vacía) del demo establecido.
// Solo lo usan el seeding y el gate de onboarding; el resto del código trata
// ambos modos igual vía isDemoActive().
export function isFreshActive() {
  return isLocalhost() && flag(FRESH_FLAG);
}

export function setDemoFlag() {
  sessionStorage.setItem(DEMO_FLAG, '1');
}

export function setFreshFlag() {
  sessionStorage.setItem(FRESH_FLAG, '1');
}

export function clearDemoFlags() {
  sessionStorage.removeItem(DEMO_FLAG);
  sessionStorage.removeItem(FRESH_FLAG);
}
