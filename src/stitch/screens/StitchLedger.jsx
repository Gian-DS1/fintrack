// Transacciones (Ledger) — layout Stitch con DATOS REALES + alta/edición/borrado.
import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import toast from 'react-hot-toast';
import { toastUndo } from '../toastUndo';
import MS from '../MS';
import Emoji from '../Emoji';
import { useScreenStrings } from '../../i18n/useScreenStrings';
import { useI18n } from '../../contexts/I18nContext';
import { tr } from '../../i18n/runtime';
import StitchCategorySelect from '../StitchCategorySelect';
import StitchSelect from '../StitchSelect';
import StitchDatePicker from '../StitchDatePicker';
import StitchCurrencyInput from '../StitchCurrencyInput';
import AutoCatChip from '../AutoCatChip';
import { inputCls, Field, FormActions, Modal } from '../formUi';
import {
  isDemoActive, demoAddTransaction, demoUpdateTransaction, demoDeleteTransaction, demoRestoreTransaction,
  demoBulkDeleteTransactions, demoRestoreManyTransactions, demoBulkAssignCategory, demoBulkAssignCard,
} from '../demoMode';
import { EASE_OUT } from '../motionTokens';
import useTransactionStore from '../../stores/useTransactionStore';
import useCategoryStore from '../../stores/useCategoryStore';
import useCreditCardStore from '../../stores/useCreditCardStore';
import useRecurringStore, { advanceDate } from '../../stores/useRecurringStore';
import { computeCashback, getTransactionCashback, hasTieredRule } from '../../utils/creditCards';
import { autoCategorize } from '../../data/defaultCategories';
import { suggestFromHistory } from '../../data/transactionMemory';
import { formatCurrency, formatDate, todayISO, titleCase, getTypeLabel } from '../../utils/formatters';

const fmt = (n) => formatCurrency(n);
// Tipos visibles en filtros. El tipo genérico 'expense' es legado (migrado a
// 'variable_expense'); ya no se ofrece. La categoría deriva el tipo real.
// TYPES se construye dinámicamente en el componente usando strings del hook
const blank = { date: todayISO(), amount: '', type: 'variable_expense', categoryId: '', cardId: '', description: '', notes: '', isRecurring: false, recurrencePattern: 'monthly' };

// Tamaño de página del listado. Renderizar miles de filas de golpe congela el
// primer paint (sobre todo en móvil); se muestran bloques y un "Mostrar más".
const PAGE_SIZE = 50;

export default function StitchLedger() {
  const strings = useScreenStrings();
  const { t } = useI18n();
  const navigate = useNavigate();

  // TYPES construido dinámicamente
  const TYPES = [
    { v: 'income', l: strings.ledger.income },
    { v: 'fixed_expense', l: strings.ledger.fixedExpense },
    { v: 'variable_expense', l: strings.ledger.variableExpense },
    { v: 'savings', l: t('types.savings') },
  ];

  // `transactions` se suscribe con selector (es el dato que muta y dispara
  // renders); las acciones del store son referencias estables, así que tomarlas
  // por separado no añade superficie de suscripción al estado completo.
  const transactions = useTransactionStore((s) => s.transactions);
  const {
    addTransaction, updateTransaction, deleteTransaction, restoreTransaction,
    bulkDeleteTransactions, restoreManyTransactions, bulkAssignCategory, bulkAssignCard,
  } = useTransactionStore();
  const categories = useCategoryStore((s) => s.categories);
  const cards = useCreditCardStore((s) => s.cards);
  const addRecurring = useRecurringStore((s) => s.addRecurring);

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blank);
  const [errors, setErrors] = useState({});
  // Autollenado inteligente: `autoSet` = campos llenados por la memoria/keywords
  // (muestran chip AUTO); `touched` = campos que el usuario tocó a mano en este
  // form (quedan excluidos del autollenado hasta cerrarlo).
  const blankSmart = { category: false, card: false };
  const [autoSet, setAutoSet] = useState(blankSmart);
  const [touched, setTouched] = useState(blankSmart);
  const resetSmart = () => { setAutoSet(blankSmart); setTouched(blankSmart); };
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterCat, setFilterCat] = useState('');
  const [filterCard, setFilterCard] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortKey, setSortKey] = useState('date'); // 'date' | 'amount'
  const [sortDir, setSortDir] = useState('desc'); // 'asc' | 'desc'

  // Selección múltiple (ids). La barra de acciones aparece cuando hay ≥1.
  const [selected, setSelected] = useState(() => new Set());

  // Render de la categoría con su emoji JoyPixels + nombre. El nombre ENVUELVE
  // contra el ancho disponible (no se trunca): una categoría kilométrica ocupa
  // más líneas, pero siempre se lee completa.
  const catCell = (id) => {
    const c = categories.find((x) => x.id === id);
    if (!c) return '—';
    return (
      <span className="inline-flex items-baseline gap-xs max-w-full min-w-0 align-bottom">
        <span className="shrink-0 self-center flex"><Emoji e={c.icon} size={16} /></span>
        <span className="break-words min-w-0">{c.name}</span>
      </span>
    );
  };

  // ¿Es un gasto? (fijo o variable). El cashback y la tarjeta solo aplican a gastos.
  const isExpenseType = (t) => t === 'expense' || t === 'fixed_expense' || t === 'variable_expense';

  // Cashback que se CONGELA en la transacción (cashback_earned). Solo aplica a
  // reglas planas; las escalonadas NO se congelan (su cashback es derivado en
  // vivo por ciclo, vía getDerivedCashback). Esto es lo que se guarda.
  const cashbackToFreeze = useMemo(() => {
    if (!form.cardId || !isExpenseType(form.type)) return 0;
    const card = cards.find((c) => c.id === form.cardId);
    const base = Number(form.amount);
    return computeCashback(card, form.categoryId, base);
  }, [form, cards]);

  // Cashback ESTIMADO que se muestra al usuario en el form. Incluye el escalonado
  // (proporcional al nivel del ciclo) para que las tarjetas CCN no muestren 0.
  const cashbackPreview = useMemo(() => {
    if (!form.cardId || !isExpenseType(form.type)) return 0;
    const card = cards.find((c) => c.id === form.cardId);
    if (!card) return 0;
    const base = Number(form.amount);
    if (!hasTieredRule(card)) return computeCashback(card, form.categoryId, base);
    // Para escalonadas, estima incluyendo esta transacción en el acumulado del ciclo.
    const txDraft = { cardId: form.cardId, categoryId: form.categoryId, amount: base, date: form.date };
    const others = transactions.filter((t) => t.id !== editing);
    return getTransactionCashback(card, txDraft, [...others, txDraft]);
  }, [form, cards, transactions, editing]);

  // El tipo de una transacción se DERIVA de su categoría: la categoría ya sabe
  // si es ingreso, gasto fijo, gasto variable o ahorro (eso es lo que el motor
  // de presupuesto base-cero usa). Por eso no se elige "Tipo" a mano.
  const typeOfCategory = (id) => categories.find((c) => c.id === id)?.type || 'variable_expense';

  // Tarjeta cuya regla de cashback apunta a esta categoría (p. ej. la CCN para el
  // Grupo CCN). Si hay varias, la primera. Devuelve su id o '' si ninguna aplica.
  const cardForCategory = (categoryId) => {
    if (!categoryId) return '';
    const card = cards.find((c) =>
      Array.isArray(c.cashbackRules) &&
      c.cashbackRules.some((r) => r.categoryId === categoryId)
    );
    return card ? card.id : '';
  };

  const onDescription = (raw) => {
    // Auto-capitaliza la primera letra mientras se escribe; al guardar,
    // titleCase completa el resto de las palabras.
    const description = raw.charAt(0).toLocaleUpperCase() + raw.slice(1);
    if (editing) { setForm((prev) => ({ ...prev, description })); return; }

    // Memoria por historial primero (lo que el usuario hizo otras veces con esta
    // descripción); keywords de fábrica como fallback. Nunca pisa campos tocados.
    const sug = suggestFromHistory(description, transactions);
    const applied = { ...autoSet };
    setForm((prev) => {
      const next = { ...prev, description };
      if (!touched.category) {
        const categoryId = sug?.categoryId || autoCategorize(description, categories)?.id || '';
        if (categoryId) {
          next.categoryId = categoryId;
          next.type = typeOfCategory(categoryId); // el tipo lo manda la categoría
          applied.category = true;
        }
      }
      if (!touched.card) {
        if (sug) {
          // '' también es respuesta: si el patrón es "sin tarjeta", no se rellena.
          next.cardId = sug.cardId;
          applied.card = !!sug.cardId;
        } else if (!next.cardId && next.categoryId) {
          // Sin historial: sugiere la tarjeta de cashback de la categoría (como hoy).
          const suggested = cardForCategory(next.categoryId);
          if (suggested) { next.cardId = suggested; applied.card = true; }
        }
      }
      return next;
    });
    setAutoSet(applied);
  };

  // Cambio manual de categoría: ese campo deja de autollenarse y pierde el chip.
  // Si la categoría tiene tarjeta de cashback asociada y aún no hay tarjeta, la
  // sugiere sin pisar una manual (comportamiento de siempre).
  const onCategoryManual = (id) => {
    setTouched((tt) => ({ ...tt, category: true }));
    setAutoSet((a) => ({ ...a, category: false }));
    setForm((f) => {
      const next = { ...f, categoryId: id, type: id ? typeOfCategory(id) : f.type };
      if (id && !f.cardId) {
        const suggested = cardForCategory(id);
        if (suggested) next.cardId = suggested;
      }
      return next;
    });
  };

  const openCreate = () => { setForm(blank); setEditing(null); setErrors({}); resetSmart(); setShowForm(true); };
  const openEdit = (t) => { setForm({ ...blank, ...t, amount: String(t.amount) }); setEditing(t.id); setErrors({}); resetSmart(); setShowForm(true); };

  const demo = isDemoActive();

  const submit = async (e) => {
    e.preventDefault();
    const err = {};
    // Number.isFinite descarta NaN: un input como "." pasa Number(x) <= 0
    // (NaN no es <= 0) y guardaría un monto inválido.
    const amount = Number(form.amount);
    if (!form.date) err.date = '1';
    if (!Number.isFinite(amount) || amount <= 0) err.amount = '1';
    if (!form.categoryId) err.categoryId = '1';
    if (Object.keys(err).length) { setErrors(err); return; }

    const description = titleCase(form.description);
    const data = { ...form, description, amount, cashbackEarned: cashbackToFreeze };

    if (editing) {
      if (demo) demoUpdateTransaction(editing, data); else await updateTransaction(editing, data);
      // El store ya muestra "Transacción actualizada" en login real; en demo no
      // hay backend que avise, así que lo emitimos aquí. (Evita el doble toast.)
      if (demo) toast.success(t('screens.ledger.updatedToast'));
    } else {
      if (demo) demoAddTransaction(data); else await addTransaction(data);
      if (form.isRecurring && !demo) {
        addRecurring({
          categoryId: form.categoryId, cardId: form.cardId, amount: Number(form.amount), type: form.type,
          description, notes: form.notes, frequency: form.recurrencePattern,
          nextDate: advanceDate(form.date, form.recurrencePattern),
        });
      }
      // El store ya muestra "Transacción guardada exitosamente" con login real;
      // en demo lo mostramos aquí (no hay backend que avise).
      if (demo) toast.success(t('screens.ledger.savedToast'));
    }
    setShowForm(false); setForm(blank); setEditing(null); resetSmart();
  };

  const onDelete = async (t) => {
    if (demo) {
      demoDeleteTransaction(t.id);
      toastUndo(tr('screens.ledger.deletedToast'), () => demoRestoreTransaction(t));
      return;
    }
    const ok = await deleteTransaction(t.id);
    if (ok) toastUndo(tr('screens.ledger.deletedToast'), () => restoreTransaction(t));
  };

  const filtered = useMemo(() => {
    let r = [...transactions];
    if (search) { const q = search.toLowerCase(); r = r.filter((t) => t.description?.toLowerCase().includes(q) || t.notes?.toLowerCase().includes(q)); }
    if (filterType) r = r.filter((t) => t.type === filterType);
    if (filterCat) r = r.filter((t) => t.categoryId === filterCat);
    // Tarjeta: 'none' filtra las transacciones sin tarjeta (efectivo); cualquier
    // otro valor es el id de una tarjeta concreta.
    if (filterCard) r = r.filter((t) => (filterCard === 'none' ? !t.cardId : t.cardId === filterCard));
    if (dateFrom) r = r.filter((t) => t.date >= dateFrom);
    if (dateTo) r = r.filter((t) => t.date <= dateTo);
    const dir = sortDir === 'asc' ? 1 : -1;
    return r.sort((a, b) => {
      let cmp;
      if (sortKey === 'amount') cmp = Math.abs(Number(a.amount)) - Math.abs(Number(b.amount));
      else cmp = a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
      // Desempate estable por fecha cuando se ordena por monto.
      if (cmp === 0 && sortKey === 'amount') cmp = a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
      return cmp * dir;
    });
  }, [transactions, search, filterType, filterCat, filterCard, dateFrom, dateTo, sortKey, sortDir]);

  // ── Paginación ──────────────────────────────────────────────────────────────
  // Se renderizan bloques de PAGE_SIZE; "Mostrar más" amplía. Al cambiar filtros
  // u orden se vuelve al primer bloque — ajuste de estado EN RENDER (patrón
  // recomendado por React), sin effect que cause un render en cascada.
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const filterKey = [search, filterType, filterCat, filterCard, dateFrom, dateTo, sortKey, sortDir].join('|');
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey);
  if (prevFilterKey !== filterKey) {
    setPrevFilterKey(filterKey);
    setVisibleCount(PAGE_SIZE);
  }
  const paged = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);
  const hiddenCount = filtered.length - paged.length;

  // Cashback a MOSTRAR por transacción, calculado EN VIVO desde las reglas
  // actuales de la tarjeta (planas y escalonadas) vía getTransactionCashback. No
  // dependemos del cashbackEarned congelado: este podía quedar en 0 (transacción
  // creada/importada antes de configurar la regla) y la fila no mostraba el
  // cashback aunque al editar sí aparecía. Calcular en vivo lo hace consistente
  // para todas las tarjetas de todos los usuarios. Mapa id→cashback, memoizado.
  // Solo para las filas VISIBLES: las escalonadas escanean todo el historial por
  // fila (O(n²) si se calculara para todas) y las ocultas no se muestran.
  const cashbackById = useMemo(() => {
    const map = new Map();
    const cardById = new Map(cards.map((c) => [c.id, c]));
    for (const t of paged) {
      const card = t.cardId ? cardById.get(t.cardId) : null;
      map.set(t.id, card ? getTransactionCashback(card, t, transactions) : 0);
    }
    return map;
  }, [paged, transactions, cards]);

  // Click en encabezado: si ya ordena por esa columna, alterna asc/desc; si no,
  // cambia de columna (fechas arrancan desc = más reciente, monto desc = mayor).
  const toggleSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('desc'); }
  };

  const hasFilters = search || filterType || filterCat || filterCard || dateFrom || dateTo;
  const clearFilters = () => { setSearch(''); setFilterType(''); setFilterCat(''); setFilterCard(''); setDateFrom(''); setDateTo(''); };

  // ── Selección múltiple ──────────────────────────────────────────────────────
  // La selección efectiva se DERIVA en render como la intersección entre lo
  // marcado y lo VISIBLE (filtrado + paginado). Así, al cambiar los filtros,
  // las filas ocultas dejan de contar automáticamente sin tocar estado en un
  // effect (evita cascading renders). Basarla en `paged` (no en `filtered`)
  // evita que las acciones en bloque toquen filas que el usuario nunca vio.
  // El Set `selected` puede contener ids "rezagados" de filas ocultas; se
  // ignoran al derivar y al ejecutar acciones.
  const pagedIds = useMemo(() => paged.map((t) => t.id), [paged]);
  const visibleSelectedIds = useMemo(
    () => pagedIds.filter((id) => selected.has(id)),
    [pagedIds, selected],
  );
  const isSelected = (id) => selected.has(id);

  const selectedCount = visibleSelectedIds.length;
  const allVisibleSelected = pagedIds.length > 0 && selectedCount === pagedIds.length;
  const someVisibleSelected = selectedCount > 0 && !allVisibleSelected;

  const toggleOne = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAll = () => setSelected((prev) => {
    if (pagedIds.every((id) => prev.has(id))) return new Set(); // todas marcadas → desmarca todo
    return new Set(pagedIds); // marca todo lo visible
  });
  const clearSelection = () => setSelected(new Set());

  // Acciones en bloque. La lógica (recalculo de cashback, persistencia) vive en
  // el store; aquí solo se orquesta + UI/toasts. En demo se usan los mutadores
  // locales equivalentes. Solo se actúa sobre ids visibles (la intersección).
  const selectedIds = () => visibleSelectedIds;

  const onBulkCategory = async (categoryId) => {
    const ids = selectedIds();
    if (demo) demoBulkAssignCategory(ids, categoryId);
    else await bulkAssignCategory(ids, categoryId);
    if (demo) toast.success(t('screens.ledger.categoriesUpdated'));
    clearSelection();
  };
  const onBulkCard = async (cardId) => {
    const ids = selectedIds();
    if (demo) demoBulkAssignCard(ids, cardId);
    else await bulkAssignCard(ids, cardId);
    if (demo) toast.success(strings.ledger.transactionsUpdated);
    clearSelection();
  };
  const onBulkDelete = async () => {
    const ids = selectedIds();
    const removed = demo ? demoBulkDeleteTransactions(ids) : await bulkDeleteTransactions(ids);
    clearSelection();
    if (removed && removed.length > 0) {
      const n = removed.length;
      toastUndo(n === 1 ? tr('screens.ledger.deletedOne') : tr('screens.ledger.deletedMany').replace('{n}', n), () => {
        if (demo) demoRestoreManyTransactions(removed); else restoreManyTransactions(removed);
      });
    }
  };


  return (
    <div className="p-md sm:p-margin-safe max-w-[1728px] mx-auto w-full">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-xl gap-md">
        <div>
          <h1 className="font-headline-lg text-headline-lg font-bold text-on-surface">{strings.ledger.title}</h1>
          <p className="font-mono-data text-mono-data text-text-muted mt-sm uppercase">
            {transactions.length} {strings.ledger.records} · {strings.ledger.synchronized}
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary ml-xs status-glow-live align-middle" />
          </p>
        </div>
        <button data-tour="ledger-new" onClick={openCreate} className="bg-primary text-on-primary font-label-sm text-label-sm uppercase tracking-widest font-bold px-md py-sm rounded hover:bg-primary-container transition-colors inner-glow flex items-center gap-xs">
          <MS name="add" className="text-[16px]" /> {strings.buttons.newTransaction}
        </button>
      </div>

      {/* Filtros. En móvil: cuadrícula simétrica de 2 columnas (búsqueda a todo
          el ancho; tipo/categoría en par; DESDE/HASTA en par con el rótulo
          encima). En sm+ vuelve a la fila envolvente original. */}
      <div data-tour="ledger-filters" className="bg-surface-container-lowest border border-border-subtle rounded-lg p-sm mb-lg grid grid-cols-2 gap-sm sm:flex sm:flex-wrap sm:items-center inner-glow">
        <div className="relative col-span-2 sm:col-auto sm:flex-1 min-w-0 sm:min-w-[200px]">
          <MS name="search" className="absolute left-sm top-1/2 -translate-y-1/2 text-text-muted !text-[14px]" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={strings.ledger.searchPlaceholder} aria-label={strings.ledger.searchPlaceholder} className="w-full h-[34px] max-sm:h-11 bg-surface-container border border-border-subtle rounded py-0 pl-[28px] pr-sm font-label-sm text-label-sm text-on-surface focus:outline-none focus:border-primary inner-glow placeholder:text-text-muted" />
        </div>
        <StitchSelect
          value={filterType}
          onChange={setFilterType}
          options={[{ value: '', label: strings.ledger.typeFilterAll }, ...TYPES.map((t) => ({ value: t.v, label: t.l }))]}
          placeholder={strings.ledger.typeFilterAll}
          compact
          className="w-full min-w-0 sm:w-auto sm:min-w-[150px]"
        />
        <StitchCategorySelect
          value={filterCat}
          onChange={setFilterCat}
          options={categories}
          includeAllOption
          allLabel={strings.ledger.categoryFilterAll}
          compact
          className="w-full min-w-0 sm:w-auto sm:min-w-[200px]"
        />
        {/* Filtro por tarjeta usada. Solo aparece si el usuario tiene tarjetas
            (sin ellas no hay nada que filtrar). 'none' = pagado sin tarjeta. En
            móvil ocupa toda la fila (col-span-2) para no romper la simetría del
            par tipo/categoría; en sm+ se envuelve como un campo más. */}
        {cards.length > 0 && (
          <StitchSelect
            value={filterCard}
            onChange={setFilterCard}
            options={[
              { value: '', label: strings.ledger.cardFilterAll },
              { value: 'none', label: t('screens.ledger.noCard') },
              ...cards.map((c) => ({ value: c.id, label: c.name })),
            ]}
            placeholder={strings.ledger.cardFilterAll}
            compact
            className="col-span-2 min-w-0 sm:col-auto sm:w-auto sm:min-w-[180px]"
          />
        )}
        <div className="col-span-2 grid grid-cols-2 gap-sm sm:flex sm:flex-wrap sm:items-center sm:gap-xs">
          {/* Rótulo encima del campo en móvil (columnas gemelas); en línea en sm+. */}
          <div className="flex flex-col gap-xs sm:flex-row sm:items-center">
            <span className="font-mono-data text-mono-data text-text-muted uppercase">{strings.ledger.from}</span>
            <StitchDatePicker value={dateFrom} max={dateTo || undefined} onChange={setDateFrom} compact className="w-full sm:w-[150px]" />
          </div>
          <div className="flex flex-col gap-xs sm:flex-row sm:items-center">
            <span className="font-mono-data text-mono-data text-text-muted uppercase">{strings.ledger.to}</span>
            <StitchDatePicker value={dateTo} min={dateFrom || undefined} onChange={setDateTo} compact className="w-full sm:w-[150px]" />
          </div>
        </div>
        {hasFilters && (
          <button onClick={clearFilters} className="col-span-2 sm:col-auto justify-center sm:justify-start flex items-center gap-xs font-mono-data text-mono-data uppercase text-text-muted hover:text-on-surface border border-border-subtle rounded px-sm py-xs max-sm:py-sm hover:bg-surface-container-high transition-colors">
            <MS name="close" className="text-[14px]" /> {t('common.clear')}
          </button>
        )}
      </div>

      {/* Tabla */}
      <div data-tour="ledger-table" className="bg-surface-container-lowest border border-border-subtle rounded-lg overflow-x-auto inner-glow relative">
        <div className="absolute inset-0 pointer-events-none opacity-[0.03]" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)', backgroundSize: '16px 16px' }} />
        {filtered.length === 0 ? (
          <div className="relative z-10 py-[80px] flex flex-col items-center gap-sm text-center">
            <MS name="receipt_long" className="text-[36px] text-text-muted" />
            <p className="font-body-md text-body-md text-on-surface-variant">{transactions.length === 0 ? t('screens.ledger.noTransactionsYet') : t('screens.ledger.noResults')}</p>
            {transactions.length === 0 && <button onClick={openCreate} className="mt-sm bg-primary text-on-primary font-label-sm text-label-sm uppercase tracking-widest px-md py-sm rounded">{t('screens.ledger.registerFirst')}</button>}
          </div>
        ) : (
          <>
            {/* Tabla (md+). En móvil se reemplaza por la lista de tarjetas de
                abajo: una tabla de 7 columnas obliga a scroll horizontal. */}
            <table className="w-full text-left border-collapse relative z-10 hidden md:table">
              <thead>
                <tr className="border-b border-border-subtle">
                  <th className="py-sm pl-md pr-0 w-[1%] align-middle">
                    <input
                      type="checkbox"
                      className="stitch-check align-middle"
                      checked={allVisibleSelected}
                      ref={(el) => { if (el) el.indeterminate = someVisibleSelected; }}
                      onChange={toggleAll}
                      aria-label={t('screens.ledger.selectAllVisible')}
                    />
                  </th>
                  <th className="py-sm px-md font-mono-data text-mono-data text-text-muted uppercase font-normal">
                    <SortHeader label={t('transactions.date')} active={sortKey === 'date'} dir={sortDir} onClick={() => toggleSort('date')} />
                  </th>
                  <th className="py-sm px-md font-mono-data text-mono-data text-text-muted uppercase font-normal">{t('common.description')}</th>
                  <th className="py-sm px-md font-mono-data text-mono-data text-text-muted uppercase font-normal">{t('common.category')}</th>
                  <th className="py-sm px-md font-mono-data text-mono-data text-text-muted uppercase font-normal">{t('common.type')}</th>
                  <th className="py-sm px-md font-mono-data text-mono-data text-text-muted uppercase font-normal text-right">
                    <SortHeader label={t('common.amount')} active={sortKey === 'amount'} dir={sortDir} onClick={() => toggleSort('amount')} alignRight />
                  </th>
                  <th className="py-sm px-md font-mono-data text-mono-data text-text-muted uppercase font-normal" />
                </tr>
              </thead>
              <tbody className="font-body-md text-body-md">
                {paged.map((t) => {
                  const inc = t.type === 'income';
                  const isSel = isSelected(t.id);
                  return (
                    <tr key={t.id} className={`border-b border-border-subtle transition-colors group ${isSel ? 'bg-primary/[0.06]' : 'hover:bg-surface-container-high'}`}>
                      <td className="py-sm pl-md pr-0 w-[1%] align-middle">
                        <input
                          type="checkbox"
                          className={`stitch-check align-middle ${isSel ? '' : 'hover-reveal'}`}
                          checked={isSel}
                          onChange={() => toggleOne(t.id)}
                          aria-label={`${tr('screens.ledger.selectTx')} ${t.description || formatDate(t.date)}`}
                        />
                      </td>
                      <td className="py-sm px-md text-on-surface-variant whitespace-nowrap font-mono-data text-mono-data">{formatDate(t.date)}</td>
                      <td className="py-sm px-md">
                        {/* break-words (sin truncate): descripciones y notas
                            largas envuelven en varias líneas, nunca "…". */}
                        <div className="text-on-surface font-medium break-words max-w-[280px]">{t.description || '—'}</div>
                        {t.notes && <div className="font-mono-data text-mono-data text-text-muted mt-0.5 break-words max-w-[280px]">{t.notes}</div>}
                      </td>
                      <td className="py-sm px-md text-on-surface-variant"><div className="max-w-[220px]">{catCell(t.categoryId)}</div></td>
                      <td className="py-sm px-md"><TypeChip type={t.type} /></td>
                      <td className={`py-sm px-md text-right font-mono-data tabular-nums whitespace-nowrap ${inc ? 'text-tertiary' : 'text-on-surface'}`}>
                        {inc ? '+' : '−'}{fmt(Math.abs(Number(t.amount)))}
                        {(cashbackById.get(t.id) || 0) > 0 && (
                          <span className="block font-mono-data text-[9px] text-tertiary">cashback +{fmt(cashbackById.get(t.id))}</span>
                        )}
                      </td>
                      <td className="py-sm px-md text-right whitespace-nowrap">
                        <button onClick={() => openEdit(t)} className="text-text-muted hover:text-primary p-xs tap-target hover-reveal" aria-label={tr('common.edit')}><MS name="edit" className="text-[16px]" /></button>
                        <button onClick={() => onDelete(t)} className="text-text-muted hover:text-accent-error p-xs tap-target hover-reveal" aria-label={tr('common.delete')}><MS name="delete" className="text-[16px]" /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Lista móvil (&lt;md): tarjetas apiladas, sin scroll horizontal.
                Retícula fija de 4 columnas: checkbox · avatar de emoji (tamaño
                fijo → todo alinea) · texto en 2 líneas · monto a la derecha.
                Tocar la tarjeta abre EDITAR (no hay íconos por fila); borrar
                vive en el modal de edición y en la barra de selección múltiple. */}
            <div className="md:hidden relative z-10">
              <div className="flex items-center gap-lg px-md py-sm border-b border-border-subtle">
                <SortHeader label={t('transactions.date')} active={sortKey === 'date'} dir={sortDir} onClick={() => toggleSort('date')} />
                <SortHeader label={t('common.amount')} active={sortKey === 'amount'} dir={sortDir} onClick={() => toggleSort('amount')} />
                <span className="flex-1" />
                <input
                  type="checkbox"
                  className="stitch-check tap-target"
                  checked={allVisibleSelected}
                  ref={(el) => { if (el) el.indeterminate = someVisibleSelected; }}
                  onChange={toggleAll}
                  aria-label={t('screens.ledger.selectAllVisible')}
                />
              </div>
              <ul>
                {paged.map((t) => {
                  const inc = t.type === 'income';
                  const isSel = isSelected(t.id);
                  const cb = cashbackById.get(t.id) || 0;
                  const cat = categories.find((x) => x.id === t.categoryId);
                  return (
                    <li key={t.id} className={`border-b border-border-subtle last:border-b-0 ${isSel ? 'bg-primary/[0.06]' : ''}`}>
                      <div className="flex items-center gap-sm px-md py-sm">
                        <input
                          type="checkbox"
                          className="stitch-check tap-target shrink-0"
                          checked={isSel}
                          onChange={() => toggleOne(t.id)}
                          aria-label={`${tr('screens.ledger.selectTx')} ${t.description || formatDate(t.date)}`}
                        />
                        <button
                          type="button"
                          onClick={() => openEdit(t)}
                          aria-label={`${tr('common.edit')}: ${t.description || formatDate(t.date)}`}
                          className="flex-1 min-w-0 flex items-center gap-sm text-left"
                        >
                          {/* Avatar de categoría (tamaño fijo): el emoji ya no va
                              inline con el texto, así las líneas base no chocan. */}
                          <span className="w-9 h-9 rounded-full bg-surface-container-high border border-border-subtle flex items-center justify-center shrink-0">
                            {cat ? <Emoji e={cat.icon} size={18} /> : <MS name="receipt_long" className="!text-[16px] text-text-muted" />}
                          </span>
                          <span className="flex-1 min-w-0">
                            {/* Todo envuelve (break-words), nada se trunca. */}
                            <span className="block text-on-surface font-medium break-words">{t.description || '—'}</span>
                            <span className="block font-mono-data text-mono-data text-text-muted normal-case tracking-normal mt-[3px] break-words">
                              {formatDate(t.date)}{cat ? ` · ${cat.name}` : ''}
                            </span>
                            {t.notes && <span className="block font-mono-data text-mono-data text-text-muted normal-case tracking-normal mt-[3px] break-words">{t.notes}</span>}
                          </span>
                          <span className="shrink-0 flex flex-col items-end gap-[3px]">
                            <span className={`font-mono-data tabular-nums whitespace-nowrap ${inc ? 'text-tertiary' : 'text-on-surface'}`}>
                              {inc ? '+' : '−'}{fmt(Math.abs(Number(t.amount)))}
                            </span>
                            {cb > 0 && <span className="font-mono-data text-mono-data text-tertiary normal-case tracking-normal whitespace-nowrap">+{fmt(cb)}</span>}
                          </span>
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* "Mostrar más": pagina el resto del historial sin recargar. */}
            {hiddenCount > 0 && (
              <button
                onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                className="relative z-10 w-full py-md border-t border-border-subtle font-mono-data text-mono-data uppercase tracking-widest text-primary hover:bg-surface-container-high transition-colors"
              >
                {t('screens.ledger.showMore').replace('{n}', Math.min(PAGE_SIZE, hiddenCount))} · {filtered.length - hiddenCount}/{filtered.length}
              </button>
            )}
          </>
        )}
      </div>

      {showForm && (
        <Modal onClose={() => setShowForm(false)} title={editing ? strings.ledger.editTransaction : strings.buttons.newTransaction} width="520px">
          {(requestClose) => (
            <form onSubmit={submit} className="flex flex-col gap-md">
              <div className="grid grid-cols-2 gap-md">
                <Field label={t('transactions.date')} error={errors.date}>
                  <StitchDatePicker value={form.date} onChange={(v) => setForm({ ...form, date: v })} />
                </Field>
                <Field label={t('common.amount')} error={errors.amount}>
                  <StitchCurrencyInput value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} className={inputCls} />
                </Field>
              </div>
              <Field label={t('common.description')}>
                <input value={form.description} onChange={(e) => onDescription(e.target.value)} placeholder={t('screens.ledger.examplePlaceholder')} className={inputCls} />
              </Field>
              <Field label={t('common.category')} error={errors.categoryId} extra={<AutoCatChip show={autoSet.category && !touched.category && !!form.categoryId} />}>
                {categories.filter((c) => c.isActive !== false).length === 0 ? (
                  <div className="flex flex-col gap-xs">
                    <p className="font-label-sm text-label-sm text-text-muted">{t('screens.ledger.noCategoriesYet')}</p>
                    <button
                      type="button"
                      onClick={() => { setShowForm(false); navigate('/categorias'); }}
                      className="text-primary font-label-sm text-label-sm underline text-left"
                    >{t('screens.ledger.createFirstCategory')}</button>
                  </div>
                ) : (
                  <StitchCategorySelect
                    value={form.categoryId}
                    onChange={onCategoryManual}
                    options={categories}
                    placeholder={t('screens.ledger.chooseCategoryPlaceholder')}
                  />
                )}
              </Field>
              {/* Tipo: derivado de la categoría (no editable). La categoría ya sabe si
                  es ingreso, gasto fijo, gasto variable o ahorro; clasificar a mano
                  era redundante. Se muestra como badge para dar claridad. */}
              <Field label={t('screens.ledger.typeByCategory')}>
                <TypeBadge type={form.type} hasCategory={!!form.categoryId} />
              </Field>
              {isExpenseType(form.type) && cards.length > 0 && (
                <Field label={t('screens.ledger.cardOptional')} extra={<AutoCatChip show={autoSet.card && !touched.card && !!form.cardId} />}>
                  <StitchSelect
                    value={form.cardId}
                    onChange={(v) => { setTouched((tt) => ({ ...tt, card: true })); setAutoSet((a) => ({ ...a, card: false })); setForm({ ...form, cardId: v }); }}
                    options={[{ value: '', label: t('screens.ledger.noCard') }, ...cards.map((c) => ({ value: c.id, label: c.name }))]}
                    placeholder={t('screens.ledger.noCard')}
                  />
                </Field>
              )}
              {cashbackPreview > 0 && <p className="font-mono-data text-mono-data text-tertiary">{t('screens.ledger.estimatedCashback')} +{fmt(cashbackPreview)}</p>}
              {!editing && (
                <label className="flex items-center gap-sm cursor-pointer">
                  <input type="checkbox" checked={form.isRecurring} onChange={(e) => setForm({ ...form, isRecurring: e.target.checked })} className="stitch-check" />
                  <span className="font-label-sm text-label-sm text-on-surface-variant">{t('screens.ledger.repeatAutomatically')} ({form.recurrencePattern === 'monthly' ? t('screens.ledger.monthly') : form.recurrencePattern})</span>
                </label>
              )}
              {/* Al editar, borrar vive aquí (las tarjetas móviles ya no tienen
                  ícono por fila; en escritorio sigue el basurero al hover). */}
              <FormActions
                onCancel={requestClose}
                label={editing ? t('common.save') : t('screens.ledger.register')}
                onDelete={editing ? () => {
                  const tx = transactions.find((x) => x.id === editing);
                  setShowForm(false);
                  if (tx) onDelete(tx);
                } : undefined}
              />
            </form>
          )}
        </Modal>
      )}

      {/* Barra contextual flotante de acciones en bloque */}
      <BulkBar
        count={selectedCount}
        categories={categories}
        cards={cards}
        onCategory={onBulkCategory}
        onCard={onBulkCard}
        onDelete={onBulkDelete}
        onClear={clearSelection}
      />
    </div>
  );
}

// Barra flotante (abajo-centro) que aparece al seleccionar ≥1 transacción.
// Entra con spring (Emil: marketing/feedback puede tener delight contenido),
// sale más rápido. Respeta reduced-motion. Categoría/Tarjeta abren un popover
// inline para elegir destino; al confirmar disparan la acción y se cierran.
function BulkBar({ count, categories, cards, onCategory, onCard, onDelete, onClear }) {
  const { t } = useI18n();
  const reduce = useReducedMotion();
  const [menu, setMenu] = useState(null); // 'category' | 'card' | null
  const open = count > 0;

  // Cuando la barra desaparece (selección a 0), el popover ya no aplica. En vez
  // de un effect (cascading render), se deriva en render: si está cerrado, el
  // menú efectivo es null. Así no hace falta sincronizar estado.
  const activeMenu = open ? menu : null;

  const variants = reduce
    ? { hidden: { opacity: 0 }, show: { opacity: 1, transition: { duration: 0.15 } }, exit: { opacity: 0, transition: { duration: 0.1 } } }
    : {
        hidden: { opacity: 0, y: 16, scale: 0.98 },
        show: { opacity: 1, y: 0, scale: 1, transition: { type: 'spring', stiffness: 320, damping: 28 } },
        exit: { opacity: 0, y: 12, scale: 0.98, transition: { duration: 0.14, ease: EASE_OUT } },
      };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          variants={variants}
          initial="hidden"
          animate="show"
          exit="exit"
          className="fixed bottom-[max(24px,env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 z-40 w-[calc(100%-32px)] max-w-[560px]"
        >
          <div className="glass-panel rounded-lg inner-glow shadow-2xl px-md py-sm flex items-center gap-sm relative">
            {/* Conteo */}
            <span className="font-mono-data text-mono-data text-on-surface uppercase tracking-widest whitespace-nowrap">
              {count === 1 ? t('screens.ledger.selectedOne') : t('screens.ledger.selectedMany').replace('{n}', count)}
            </span>
            <span className="w-px h-5 bg-border-subtle mx-xs" />

            {/* Acciones */}
            {/* En pantallas muy angostas los rótulos se ocultan (queda el icono
                con aria-label): tres botones con texto no caben junto al conteo. */}
            <button
              onClick={() => setMenu((m) => (m === 'category' ? null : 'category'))}
              aria-label={t('common.category')}
              className={`flex items-center gap-xs font-label-sm text-label-sm rounded px-sm py-xs max-sm:py-sm transition-colors ${activeMenu === 'category' ? 'bg-surface-container-high text-on-surface' : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'}`}
            >
              <MS name="sell" className="!text-[16px]" /> <span className="hidden sm:inline">{t('common.category')}</span>
            </button>
            <button
              onClick={() => setMenu((m) => (m === 'card' ? null : 'card'))}
              aria-label={t('creditCards.card')}
              className={`flex items-center gap-xs font-label-sm text-label-sm rounded px-sm py-xs max-sm:py-sm transition-colors ${activeMenu === 'card' ? 'bg-surface-container-high text-on-surface' : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'}`}
            >
              <MS name="credit_card" className="!text-[16px]" /> <span className="hidden sm:inline">{t('creditCards.card')}</span>
            </button>
            <button
              onClick={onDelete}
              aria-label={t('common.delete')}
              className="flex items-center gap-xs font-label-sm text-label-sm rounded px-sm py-xs max-sm:py-sm text-accent-error hover:bg-accent-error/10 transition-colors"
            >
              <MS name="delete" className="!text-[16px]" /> <span className="hidden sm:inline">{t('common.delete')}</span>
            </button>

            <span className="flex-1" />
            <button onClick={onClear} aria-label={t('screens.ledger.clearSelection')} className="text-text-muted hover:text-on-surface p-xs rounded hover:bg-surface-container-high transition-colors">
              <MS name="close" className="!text-[18px]" />
            </button>

            {/* Popover de elección (categoría / tarjeta) */}
            <AnimatePresence>
              {activeMenu && (
                <motion.div
                  initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.98 }}
                  animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1, transition: { type: 'spring', stiffness: 360, damping: 30 } }}
                  exit={{ opacity: 0, transition: { duration: 0.12 } }}
                  style={{ transformOrigin: 'bottom left' }}
                  className="absolute bottom-full left-0 mb-sm w-[280px] bg-surface-card border border-border-subtle rounded-lg inner-glow shadow-xl p-sm max-h-[300px] overflow-y-auto stitch-scroll"
                >
                  <div className="font-mono-data text-mono-data text-text-muted uppercase tracking-widest px-sm py-xs">
                    {activeMenu === 'category' ? t('screens.ledger.moveToCategory') : t('screens.ledger.assignCard')}
                  </div>
                  {activeMenu === 'card' && (
                    <button
                      onClick={() => { onCard(''); setMenu(null); }}
                      className="w-full text-left flex items-center gap-sm px-sm py-sm rounded font-body-md text-body-md text-on-surface-variant hover:bg-surface-container-high transition-colors"
                    >
                      <MS name="block" className="!text-[16px] text-text-muted" /> {t('screens.ledger.noCard')}
                    </button>
                  )}
                  {activeMenu === 'category'
                    ? categories.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => { onCategory(c.id); setMenu(null); }}
                          className="w-full text-left flex items-center gap-sm px-sm py-sm rounded font-body-md text-body-md text-on-surface hover:bg-surface-container-high transition-colors"
                        >
                          <Emoji e={c.icon} size={16} /> <span className="break-words min-w-0">{c.name}</span>
                        </button>
                      ))
                    : cards.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => { onCard(c.id); setMenu(null); }}
                          className="w-full text-left flex items-center gap-sm px-sm py-sm rounded font-body-md text-body-md text-on-surface hover:bg-surface-container-high transition-colors"
                        >
                          <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: c.color || '#bec2ff' }} />
                          <span className="break-words min-w-0">{c.name}</span>
                        </button>
                      ))}
                  {activeMenu === 'card' && cards.length === 0 && (
                    <div className="px-sm py-sm font-label-sm text-label-sm text-text-muted">{t('screens.ledger.noCardsRegistered')}</div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}


// Chip del tipo de transacción en las filas del listado (tabla y tarjetas
// móviles comparten exactamente el mismo estilo).
function TypeChip({ type }) {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm bg-surface-container-high border border-border-subtle font-mono-data text-[9px] text-on-surface-variant uppercase tracking-wider whitespace-nowrap">
      {getTypeLabel(type)}
    </span>
  );
}

// Badge de solo lectura del tipo derivado de la categoría. Color por tipo,
// alineado con los tokens del tema (lima=ingreso, durazno=fijo, periwinkle=
// variable, cian=ahorro).
const TYPE_META = {
  income: { icon: 'trending_up', cls: 'text-tertiary border-tertiary/40' },
  fixed_expense: { icon: 'event_repeat', cls: 'text-accent-warning border-accent-warning/40' },
  variable_expense: { icon: 'shopping_cart', cls: 'text-primary border-primary/40' },
  expense: { icon: 'payments', cls: 'text-on-surface-variant border-border-subtle' },
  savings: { icon: 'savings', cls: 'text-secondary border-secondary/40' },
};
function TypeBadge({ type, hasCategory }) {
  const { t } = useI18n();
  if (!hasCategory) {
    return <span className="font-label-sm text-label-sm text-text-muted italic">{t('screens.ledger.chooseCategoryFirst')}</span>;
  }
  const m = TYPE_META[type] || TYPE_META.variable_expense;
  return (
    <span className={`inline-flex items-center gap-[3px] self-start font-mono-data text-[9px] uppercase tracking-wider font-medium border rounded-full px-[6px] py-[2px] leading-none ${m.cls}`}>
      <MS name={m.icon} className="!text-[11px] leading-none" />
      {getTypeLabel(type === 'expense' ? 'expense' : type)}
    </span>
  );
}

// Encabezado de columna ordenable. Muestra la flecha (asc/desc) solo cuando esa
// columna está activa; inactiva muestra un ícono tenue de "ordenable". Colores
// del tema (primary cuando activo). Estilo Stitch.
function SortHeader({ label, active, dir, onClick, alignRight = false }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${t('screens.ledger.sortBy')} ${label.toLowerCase()}`}
      className={`inline-flex items-center gap-[3px] font-mono-data text-mono-data uppercase tracking-wider transition-colors ${
        alignRight ? 'flex-row-reverse' : ''
      } ${active ? 'text-primary' : 'text-text-muted hover:text-on-surface-variant'}`}
    >
      {label}
      <MS
        name={active ? (dir === 'asc' ? 'arrow_upward' : 'arrow_downward') : 'unfold_more'}
        className={`!text-[13px] leading-none ${active ? 'text-primary' : 'text-text-muted/60'}`}
      />
    </button>
  );
}


