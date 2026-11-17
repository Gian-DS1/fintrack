// FinTrack — Default Categories for Dominican Republic

import { generateId } from '../utils/formatters.js';

export const defaultCategories = [
  // ── Income ──────────────────────────────────────────────────
  {
    id: generateId(),
    name: 'Salario',
    type: 'income',
    icon: '💼',
    color: '#10b981',
    keywords: ['salario', 'sueldo', 'nomina', 'quincena', 'pago de nomina', 'pago quincenal'],
    isActive: true,
  },
  {
    id: generateId(),
    name: 'Inversiones',
    type: 'income',
    icon: '📈',
    color: '#3b82f6',
    keywords: ['darwinex', 'inversion', 'inversiones', 'dividendo', 'intereses', 'trading', 'acciones', 'broker', 'etf', 'cripto', 'bitcoin'],
    isActive: true,
  },
  {
    id: generateId(),
    name: 'Otros Ingresos',
    type: 'income',
    icon: '💰',
    color: '#8b5cf6',
    keywords: ['bono', 'reembolso', 'transferencia recibida', 'devolucion', 'freelance', 'proyecto', 'consultoria', 'cliente', 'pago cliente'],
    isActive: true,
  },

  // ── Fixed Expenses ──────────────────────────────────────────
  {
    id: generateId(),
    name: 'Alquiler',
    type: 'fixed_expense',
    icon: '🏠',
    color: '#6366f1',
    keywords: ['alquiler', 'renta', 'apartamento', 'mensualidad apartamento', 'inquilino'],
    isActive: true,
  },
  {
    id: generateId(),
    name: 'Internet',
    slug: 'internet',
    type: 'fixed_expense',
    icon: '📶',
    color: '#3b82f6',
    keywords: ['internet', 'wifi', 'fibra', 'claro internet', 'altice internet', 'wind internet', 'viva internet', 'modem', 'router', 'banda ancha'],
    isActive: true,
  },
  {
    id: generateId(),
    name: 'Teléfono',
    slug: 'telefono',
    type: 'fixed_expense',
    icon: '📱',
    color: '#0ea5e9',
    keywords: ['telefono', 'celular', 'plan movil', 'recarga', 'minutos', 'datos moviles', 'factura claro', 'factura altice', 'prepago', 'postpago'],
    isActive: true,
  },
  {
    id: generateId(),
    name: 'Luz',
    type: 'fixed_expense',
    icon: '💡',
    color: '#f59e0b',
    keywords: ['luz', 'electricidad', 'edenorte', 'edesur', 'edeeste', 'cdeee', 'factura luz', 'energia', 'corriente'],
    isActive: true,
  },
  {
    id: generateId(),
    name: 'Agua',
    type: 'fixed_expense',
    icon: '🚿',
    color: '#06b6d4',
    keywords: ['agua', 'caasd', 'coraasan', 'inapa', 'coraapplata', 'factura agua', 'botellon', 'camion de agua'],
    isActive: true,
  },
  {
    id: generateId(),
    name: 'Gas',
    type: 'fixed_expense',
    icon: '🔥',
    color: '#f97316',
    keywords: ['gas', 'propano', 'gas propano', 'tropigas', 'cilindro de gas', 'planta de gas', 'gas del hogar'],
    isActive: true,
  },
  {
    id: generateId(),
    name: 'Seguro',
    type: 'fixed_expense',
    icon: '🛡️',
    color: '#10b981',
    keywords: ['seguro', 'poliza', 'aseguradora', 'seguro medico', 'ars', 'senasa', 'humano', 'palic', 'universal', 'mapfre', 'seguros', 'primas seguro'],
    isActive: true,
  },
  {
    id: generateId(),
    name: 'Mantenimiento de Vehículo',
    type: 'fixed_expense',
    icon: '🔧',
    color: '#f43f5e',
    keywords: ['mantenimiento vehiculo', 'aceite', 'cambio de aceite', 'taller', 'mecanico', 'repuesto', 'goma', 'neumatico', 'llanta', 'vehicas', 'marbete', 'revista'],
    isActive: true,
  },
  {
    id: generateId(),
    name: 'Lavado de Vehículo',
    type: 'fixed_expense',
    icon: '🧼',
    color: '#38bdf8',
    keywords: ['lavado de vehiculo', 'lavado de carro', 'lavado de auto', 'autolavado', 'lavadero', 'car wash', 'detailing', 'pulido'],
    isActive: true,
  },
  {
    id: generateId(),
    name: 'Seguro de Vehículo',
    type: 'fixed_expense',
    icon: '🚗',
    color: '#fb7185',
    keywords: ['seguro vehiculo', 'seguro carro', 'seguro de auto', 'poliza vehiculo', 'seguro vehicular', 'seguro de motor'],
    isActive: true,
  },
  {
    id: generateId(),
    name: 'Suscripciones Digitales',
    slug: 'suscripciones',
    type: 'fixed_expense',
    icon: '📺',
    color: '#a855f7',
    keywords: ['netflix', 'spotify', 'apple music', 'disney', 'hbo', 'max', 'youtube premium', 'suscripcion', 'prime video', 'icloud', 'google one', 'chatgpt', 'cvwizard', 'crunchyroll'],
    isActive: true,
  },
  {
    id: generateId(),
    name: 'Gimnasio',
    type: 'fixed_expense',
    icon: '🏋️',
    color: '#22c55e',
    keywords: ['gimnasio', 'gym', 'crossfit', 'yoga', 'pilates', 'membresia', 'gobody', 'world gym', 'smart fit', 'spinning'],
    isActive: true,
  },
  {
    id: generateId(),
    name: 'Pago de Préstamos y Deudas',
    type: 'fixed_expense',
    icon: '🏛️',
    color: '#dc2626',
    // slug estable: la sincronización Deudas→Transacciones la busca por aquí, no
    // por el nombre (que el usuario puede renombrar).
    slug: 'pago-deuda',
    keywords: ['prestamo', 'prestamos', 'cuota', 'capital', 'abono a deuda', 'financiamiento', 'tarjeta de credito', 'pago tarjeta', 'asociacion', 'cooperativa'],
    isActive: true,
  },

  // ── Variable Expenses ───────────────────────────────────────
  {
    id: generateId(),
    name: 'Supermercado',
    slug: 'supermercado',
    type: 'variable_expense',
    icon: '🛒',
    color: '#ef4444',
    keywords: ['supermercado', 'pricesmart', 'colmado', 'almacen', 'aprovisiones', 'super', 'pola'],
    isActive: true,
  },
  {
    id: generateId(),
    name: 'Restaurantes y Delivery',
    slug: 'restaurantes',
    type: 'variable_expense',
    icon: '🍕',
    color: '#ec4899',
    keywords: ['restaurante', 'pizza', 'jade', 'teriyaki', 'mcdonald', 'burger', 'kfc', 'wendy', 'uber eats', 'pedidosya', 'delivery', 'empanada', 'hotdog', 'cafe', 'american cafe', 'adrian tropical', 'comida', 'almuerzo', 'cena', 'desayuno', 'pollo'],
    isActive: true,
  },
  {
    id: generateId(),
    name: 'Combustible',
    slug: 'combustible',
    type: 'variable_expense',
    icon: '⛽',
    color: '#f97316',
    keywords: ['gasolina', 'combustible', 'gasoil', 'bomba', 'estacion de servicio', 'texaco', 'shell', 'sunix', 'isla', 'gasolinera', 'tanque lleno'],
    isActive: true,
  },
  {
    id: generateId(),
    name: 'Reparación de Vehículo',
    type: 'variable_expense',
    icon: '🔩',
    color: '#fb923c',
    keywords: ['reparacion de vehiculo', 'reparacion de carro', 'reparacion de auto', 'reparacion motor', 'chapisteria', 'desabolladura', 'pintura de carro', 'grua', 'embrague', 'transmision', 'frenos', 'bomba de agua', 'radiador', 'alternador'],
    isActive: true,
  },
  {
    id: generateId(),
    name: 'Taxi y Transporte',
    slug: 'transporte',
    type: 'variable_expense',
    icon: '🚕',
    color: '#fbbf24',
    keywords: ['uber', 'taxi', 'didi', 'indriver', 'cabify', 'transporte', 'pasaje', 'peaje', 'parqueo', 'estacionamiento', 'metro', 'telecabina', 'omsa', 'concho', 'motoconcho'],
    isActive: true,
  },
  {
    id: generateId(),
    name: 'Ropa',
    type: 'variable_expense',
    icon: '👗',
    color: '#e11d48',
    keywords: ['ropa', 'camisa', 'pantalon', 'vestido', 'zara', 'forever 21', 'tienda de ropa', 'zapatos', 'tenis', 'zapatillas', 'calzado', 'medias', 'ropa interior', 'bermuda'],
    isActive: true,
  },
  {
    id: generateId(),
    name: 'Hogar',
    slug: 'hogar',
    type: 'variable_expense',
    icon: '🛠️',
    color: '#14b8a6',
    keywords: ['ferreteria', 'pintura', 'plomero', 'electricista', 'reparacion', 'nevera', 'estufa', 'corripio', 'ikea', 'mueble', 'colchon', 'decoracion', 'casa cuesta', 'sodimac', 'utensilios', 'bombillo', 'herramienta', 'abanico'],
    isActive: true,
  },
  {
    id: generateId(),
    name: 'Amazon',
    slug: 'amazon',
    type: 'variable_expense',
    icon: '📦',
    color: '#6366f1',
    keywords: ['amazon', 'aliexpress', 'shein', 'temu', 'ebay', 'compra online', 'headset', 'cable hdmi', 'accesorio', 'gadget', 'electronica', 'audifonos', 'mouse', 'teclado', 'wish', 'air duster'],
    isActive: true,
  },
  {
    id: generateId(),
    name: 'Compras',
    type: 'variable_expense',
    icon: '🛍️',
    color: '#f59e0b',
    keywords: ['compras', 'tienda', 'plaza', 'centro comercial', 'agora', 'sambil', 'blue mall', 'megacentro', 'shopping', 'varios', 'miscelaneos', 'galeria'],
    isActive: true,
  },
  {
    id: generateId(),
    name: 'Farmacia y Medicamentos',
    slug: 'farmacia',
    type: 'variable_expense',
    icon: '💊',
    color: '#ef4444',
    keywords: ['farmacia', 'medicamento', 'carol', 'los hidalgos', 'gbc', 'medicina', 'pastilla', 'vitamina', 'suplemento', 'receta', 'gelofen', 'acetaminofen'],
    isActive: true,
  },
  {
    id: generateId(),
    name: 'Belleza',
    type: 'variable_expense',
    icon: '💅',
    color: '#f472b6',
    keywords: ['belleza', 'maquillaje', 'unas', 'manicure', 'pedicure', 'cosmeticos', 'crema', 'skincare', 'perfume', 'nail', 'spa', 'cejas', 'pestanas'],
    isActive: true,
  },
  {
    id: generateId(),
    name: 'Viajes',
    type: 'variable_expense',
    icon: '✈️',
    color: '#0891b2',
    keywords: ['vuelo', 'hotel', 'airbnb', 'excursion', 'viaje', 'aeropuerto', 'maleta', 'resort', 'playa', 'turismo', 'booking', 'despegar', 'pasaje aereo'],
    isActive: true,
  },
  {
    id: generateId(),
    name: 'Mascotas',
    slug: 'mascotas',
    type: 'variable_expense',
    icon: '🐾',
    color: '#a3e635',
    keywords: ['mascota', 'veterinario', 'perro', 'gato', 'comida de mascota', 'veterinaria', 'pet', 'petfood', 'consulta veterinaria'],
    isActive: true,
  },
  {
    id: generateId(),
    name: 'Regalos y Donaciones',
    type: 'variable_expense',
    icon: '🎁',
    color: '#d946ef',
    keywords: ['regalo', 'donacion', 'cumpleanos', 'aguinaldo', 'propina', 'ofrenda', 'iglesia', 'caridad', 'diezmo'],
    isActive: true,
  },
  {
    id: generateId(),
    name: 'Courier',
    type: 'variable_expense',
    icon: '🚚',
    color: '#94a3b8',
    keywords: ['courier', 'envio', 'paquete', 'eps', 'vimenpaq', 'domex', 'aeropaq', 'casillero', 'inbox', 'encomienda', 'box'],
    isActive: true,
  },
  {
    id: generateId(),
    name: 'Cuidado Personal',
    type: 'variable_expense',
    icon: '💇',
    color: '#ec4899',
    keywords: ['pelo', 'barberia', 'barber', 'salon', 'peluqueria', 'corte de pelo', 'tinte', 'keratina', 'higiene', 'desodorante'],
    isActive: true,
  },
  {
    id: generateId(),
    name: 'Educación',
    slug: 'educacion',
    type: 'variable_expense',
    icon: '📚',
    color: '#0ea5e9',
    keywords: ['estudios', 'universidad', 'colegio', 'curso', 'libro', 'matricula', 'diplomado', 'maestria', 'clases', 'udemy', 'platzi', 'inscripcion', 'mensualidad colegio'],
    isActive: true,
  },
  {
    id: generateId(),
    name: 'Entretenimiento',
    slug: 'entretenimiento',
    type: 'variable_expense',
    icon: '🎬',
    color: '#8b5cf6',
    keywords: ['cine', 'pelicula', 'fiesta', 'bar', 'discoteca', 'concierto', 'evento', 'boletos', 'teatro', 'karaoke', 'billar', 'boliche', 'salida', 'juego', 'videojuego', 'steam', 'playstation'],
    isActive: true,
  },
  {
    id: generateId(),
    name: 'Salud',
    type: 'variable_expense',
    icon: '🏥',
    color: '#10b981',
    keywords: ['medico', 'doctor', 'hospital', 'clinica', 'dentista', 'optica', 'cemdoe', 'consulta medica', 'laboratorio', 'analisis', 'radiografia', 'terapia', 'psicologo', 'cirugia'],
    isActive: true,
  },

  // ── Savings ─────────────────────────────────────────────────
  {
    id: generateId(),
    name: 'Ahorro General',
    type: 'savings',
    icon: '🏦',
    color: '#06b6d4',
    keywords: ['ahorro', 'deposito', 'meta de ahorro', 'guardar', 'ahorrar'],
    isActive: true,
  },
  {
    id: generateId(),
    name: 'Fondo de Emergencia',
    type: 'savings',
    icon: '🆘',
    color: '#f59e0b',
    keywords: ['emergencia', 'reserva', 'fondo de emergencia', 'imprevisto'],
    isActive: true,
  },
];

// Quita acentos y normaliza a minúsculas para un matcheo robusto e insensible a
// tildes ("educacion" matchea "Educación", "telefono" matchea "Teléfono").
export function normalize(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Auto-categorize a transaction description based on keywords.
 *
 * Mejoras de inteligencia frente a la versión anterior:
 *   - Insensible a acentos y mayúsculas (normaliza ambos lados).
 *   - Una coincidencia de PALABRA COMPLETA pesa mucho más que una subcadena
 *     suelta, evitando falsos positivos (p. ej. "total" dentro de "subtotal").
 *   - El puntaje favorece keywords más largas/específicas, así "uber eats"
 *     (Restaurantes) gana sobre "uber" (Taxi) cuando ambas aparecen.
 */
export function autoCategorize(description, categories) {
  if (!description) return null;
  const desc = normalize(description);
  if (!desc) return null;

  // Última "palabra" que el usuario está escribiendo (para matcheo por prefijo
  // mientras teclea, sin esperar a completar la keyword). Solo se usa si tiene
  // ≥3 caracteres, para evitar falsos positivos con prefijos muy cortos.
  const lastWord = desc.split(/[^a-z0-9]+/).filter(Boolean).pop() || '';
  const canPrefix = lastWord.length >= 3;

  let bestMatch = null;
  let bestScore = 0;

  for (const category of categories) {
    if (!category.isActive || !category.keywords) continue;

    for (const rawKeyword of category.keywords) {
      const keyword = normalize(rawKeyword);
      if (!keyword) continue;

      let score = 0;
      if (desc.includes(keyword)) {
        // Match completo: keyword contenida en la descripción.
        const wholeWord = new RegExp(`(^|[^a-z0-9])${escapeRegExp(keyword)}([^a-z0-9]|$)`).test(desc);
        score = keyword.length * (wholeWord ? 10 : 1);
      } else if (canPrefix && keyword.startsWith(lastWord)) {
        // Match por PREFIJO mientras escribe: "superm" → "supermercado".
        // Peso proporcional a lo escrito (favorece prefijos más largos), pero
        // por debajo de cualquier match completo para no pisarlo.
        score = lastWord.length * 2;
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = category;
      }
    }
  }

  return bestMatch;
}

/**
 * Find exact duplicate categories (same normalized name + type). Keeps the
 * FIRST occurrence of each group as canonical and returns the remapping needed
 * to reassign references (transactions, budgets) before deleting the rest.
 *
 * @param {Array} categories - list of {id, name, type}
 * @returns {{ remap: {fromId: string, toId: string}[], deleteIds: string[] }}
 */
export function findDuplicateCategories(categories) {
  const groups = new Map();
  for (const c of categories) {
    const key = `${(c.name || '').trim().toLowerCase()}|${c.type}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }

  const remap = [];
  const deleteIds = [];
  for (const list of groups.values()) {
    if (list.length <= 1) continue;
    const keeper = list[0];
    for (let i = 1; i < list.length; i++) {
      remap.push({ fromId: list[i].id, toId: keeper.id });
      deleteIds.push(list[i].id);
    }
  }

  return { remap, deleteIds };
}
