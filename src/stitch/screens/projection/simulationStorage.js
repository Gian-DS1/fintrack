// Estado de la simulación de «Proyección»: vive SOLO en el dispositivo
// (localStorage), nunca en Supabase ni en los stores. Todo acceso va envuelto en
// try/catch (modo privado, almacenamiento bloqueado o lleno) y cae a los valores
// por defecto: la pantalla funciona igual sin almacenamiento.
//
// La clave va versionada y es POR USUARIO (en demo, 'demo'): en un dispositivo
// compartido nadie ve la simulación de otro. Se borra entera al cerrar sesión
// (clearUserData → clearSimulations); la clave sin versión de antes también.

const KEY_PREFIX = 'fintrack-projection-simulation';
export const simulationKey = (userId) => `${KEY_PREFIX}:v1:${userId}`;
export const SCENARIOS = ['current', 'essential', 'cuts'];
export const MIN_CUT_PCT = 0.1;
export const MAX_CUT_PCT = 0.5;

export const DEFAULT_SIMULATION = {
  scenario: 'current',
  cutPct: 0.2,
  excludedRecurringIds: [],
  variableOverride: null,
  essentialCategoryIds: [],
  includeFixedUnscheduled: true,
};

const stringList = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);

// Cada campo se valida por separado: un valor corrupto no tira el resto.
function sanitize(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_SIMULATION };
  const cut = Number(raw.cutPct);
  const override = raw.variableOverride;
  return {
    scenario: SCENARIOS.includes(raw.scenario) ? raw.scenario : DEFAULT_SIMULATION.scenario,
    cutPct: Number.isFinite(cut) && raw.cutPct !== null
      ? Math.min(MAX_CUT_PCT, Math.max(MIN_CUT_PCT, cut))
      : DEFAULT_SIMULATION.cutPct,
    excludedRecurringIds: stringList(raw.excludedRecurringIds),
    variableOverride: typeof override === 'number' && Number.isFinite(override) && override >= 0 ? override : null,
    essentialCategoryIds: stringList(raw.essentialCategoryIds),
    includeFixedUnscheduled: typeof raw.includeFixedUnscheduled === 'boolean'
      ? raw.includeFixedUnscheduled
      : DEFAULT_SIMULATION.includeFixedUnscheduled,
  };
}

// En Node (tests) y en algunos navegadores acceder a localStorage lanza o no existe.
export function defaultStorage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

export function loadSimulation(userId, storage = defaultStorage()) {
  try {
    const text = storage?.getItem(simulationKey(userId));
    return text ? sanitize(JSON.parse(text)) : { ...DEFAULT_SIMULATION };
  } catch {
    return { ...DEFAULT_SIMULATION };
  }
}

/** @returns {boolean} true si se guardó. */
export function saveSimulation(simulation, userId, storage = defaultStorage()) {
  try {
    if (!storage) return false;
    storage.setItem(simulationKey(userId), JSON.stringify(sanitize(simulation)));
    return true;
  } catch {
    return false;
  }
}

/** Borra la simulación de todos los usuarios (fin de sesión), con la clave antigua incluida. */
export function clearSimulations(storage = defaultStorage()) {
  try {
    if (!storage) return;
    const keys = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key && key.startsWith(KEY_PREFIX)) keys.push(key);
    }
    keys.forEach((key) => storage.removeItem(key));
  } catch {
    // Almacenamiento bloqueado: no hay nada que limpiar.
  }
}
