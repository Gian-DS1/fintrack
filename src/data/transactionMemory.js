// Memoria de transacciones — la app "aprende" del usuario sin guardar nada
// nuevo: su historial YA es la memoria. Dada la descripción que teclea, busca
// transacciones pasadas iguales (o similares, por contención) y deduce
// categoría y tarjeta según lo que eligió las veces anteriores.
// La moneda es única por perfil (currencyRuntime) y no se sugiere desde aquí.
// Funciones puras, sin React ni stores (misma convención que autoCategorize).
import { normalize } from './defaultCategories.js';

// Por debajo de esto el matcheo es ruido ("el", "la", iniciales).
const MIN_LEN = 4;

// Valor más frecuente de `field` entre las candidatas; a igual frecuencia gana
// el de la transacción más reciente. `allowEmpty`: si ''/null compite como
// valor (tarjeta sí — "sin tarjeta" es un patrón; categoría/moneda no).
function pickField(candidates, field, allowEmpty = false) {
  const stats = new Map(); // valor → { count, lastDate }
  for (const t of candidates) {
    const value = t[field] == null ? '' : t[field];
    if (!allowEmpty && value === '') continue;
    const s = stats.get(value) || { count: 0, lastDate: '' };
    s.count += 1;
    if ((t.date || '') > s.lastDate) s.lastDate = t.date || '';
    stats.set(value, s);
  }
  let best = null;
  let bestStats = null;
  for (const [value, s] of stats) {
    if (!bestStats || s.count > bestStats.count ||
        (s.count === bestStats.count && s.lastDate > bestStats.lastDate)) {
      best = value;
      bestStats = s;
    }
  }
  return best; // null si ninguna candidata aportó valor
}

// → { categoryId, cardId, source: 'exact'|'partial' } | null
export function suggestFromHistory(description, transactions) {
  const q = normalize(description);
  if (q.length < MIN_LEN) return null;

  const withDesc = (transactions || []).filter((t) => t.description);
  let candidates = withDesc.filter((t) => normalize(t.description) === q);
  let source = 'exact';
  if (candidates.length === 0) {
    source = 'partial';
    candidates = withDesc.filter((t) => {
      const d = normalize(t.description);
      return d.length >= MIN_LEN && (d.includes(q) || q.includes(d));
    });
  }
  if (candidates.length === 0) return null;

  return {
    categoryId: pickField(candidates, 'categoryId') ?? '',
    cardId: pickField(candidates, 'cardId', true) ?? '',
    source,
  };
}
