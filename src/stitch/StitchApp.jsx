// StitchApp — raíz de la app (auth, fetches de stores, rutas protegidas,
// recurrentes) montando el shell + pantallas Stitch.

import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import toast, { Toaster } from 'react-hot-toast';
import { lazy, Suspense, useEffect, useState } from 'react';

import StitchHead from './StitchHead';
import StitchShell from './StitchShell';
import { DEFAULT_TITLE } from './usePageTitle';
import './stitch.css';

// Pantallas con code-splitting por ruta: el bundle inicial solo trae el shell;
// cada pantalla (y sus librerías pesadas, p. ej. recharts en el dashboard) se
// descarga al navegar. React Router envuelve las navegaciones en transiciones,
// así que al cambiar de ruta no hay flash del fallback: la UI actual se queda
// hasta que el chunk llega.
const StitchAuth = lazy(() => import('./screens/StitchAuth'));
const StitchLanding = lazy(() => import('./screens/StitchLanding'));
const StitchDashboard = lazy(() => import('./screens/StitchDashboard'));
const StitchLedger = lazy(() => import('./screens/StitchLedger'));
const StitchBudget = lazy(() => import('./screens/StitchBudget'));
const StitchFinances = lazy(() => import('./screens/StitchFinances'));
const StitchCalendar = lazy(() => import('./screens/StitchCalendar'));
const StitchSettings = lazy(() => import('./screens/StitchSettings'));
const StitchFeedback = lazy(() => import('./screens/StitchFeedback'));
const StitchCategories = lazy(() => import('./screens/StitchCategories'));
const CurrencyOnboarding = lazy(() => import('./screens/CurrencyOnboarding'));

import { useAuth } from '../contexts/AuthContext';
import { isDemoActive, isFreshActive, seedDemoStores, seedFreshStores } from './demoMode';
import useCategoryStore from '../stores/useCategoryStore';
import useTransactionStore from '../stores/useTransactionStore';
import useBudgetStore from '../stores/useBudgetStore';
import useBudgetGroupStore from '../stores/useBudgetGroupStore';
import useSavingsStore from '../stores/useSavingsStore';
import useDebtStore from '../stores/useDebtStore';
import useCreditCardStore from '../stores/useCreditCardStore';
import useRecurringStore from '../stores/useRecurringStore';
import usePrefsStore from '../stores/usePrefsStore';

const toasterOptions = {
  position: 'top-right',
  toastOptions: {
    style: {
      background: '#101112',
      color: '#e5e2e3',
      border: '1px solid #232426',
      fontSize: '13px',
    },
  },
};

function LoadingScreen({ label }) {
  return (
    <div className="stitch-root flex items-center justify-center min-h-screen">
      <div className="flex items-center gap-sm font-mono-data text-mono-data text-text-muted uppercase tracking-widest">
        <span className="w-2 h-2 rounded-full bg-primary status-glow-live" />
        {label}
      </div>
    </div>
  );
}

// Gate de autenticación que vive DENTRO del router para poder leer la ruta
// y redirigir a / cuando no hay sesión, evitando URLs residuales.
function AuthGate() {
  const { user, loading, isRecoveringPassword } = useAuth();
  const location = useLocation();

  const demo = isDemoActive();
  const fresh = isFreshActive();
  const authedUser = user || (demo ? { id: 'demo', email: 'demo@local' } : null);
  const isPublic = !authedUser || isRecoveringPassword;

  const [showAuth, setShowAuth] = useState(false);

  const fetchCategories = useCategoryStore((s) => s.fetchCategories);
  const fetchTransactions = useTransactionStore((s) => s.fetchTransactions);
  const fetchBudgets = useBudgetStore((s) => s.fetchBudgets);
  const fetchBudgetGroups = useBudgetGroupStore((s) => s.fetchGroups);
  const fetchGoals = useSavingsStore((s) => s.fetchGoals);
  const fetchDebtsAndPayments = useDebtStore((s) => s.fetchDebtsAndPayments);
  const fetchCards = useCreditCardStore((s) => s.fetchCards);
  const fetchPrefs = usePrefsStore((s) => s.fetchPrefs);
  const currency = usePrefsStore((s) => s.currency);
  const prefsLoaded = usePrefsStore((s) => s.prefsLoaded);
  const fetchRecurring = useRecurringStore((s) => s.fetchRecurring);
  const materializeDue = useRecurringStore((s) => s.materializeDue);

  useEffect(() => {
    if (demo) {
      queueMicrotask(fresh ? seedFreshStores : seedDemoStores);
      // En demo no corre el effect de fetches (no hay user real); fetchPrefs marca
      // prefsLoaded para que el auto-arranque del tutorial pueda decidir.
      fetchPrefs();
    }
  }, [demo, fresh, fetchPrefs]);

  useEffect(() => {
    if (!user) return;
    fetchCategories();
    fetchTransactions();
    fetchBudgets();
    fetchBudgetGroups();
    fetchGoals();
    fetchDebtsAndPayments();
    fetchCards();
    fetchPrefs();
  }, [user, fetchCategories, fetchTransactions, fetchBudgets, fetchBudgetGroups, fetchGoals, fetchDebtsAndPayments, fetchCards, fetchPrefs]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      await fetchRecurring();
      if (cancelled) return;
      const res = await materializeDue();
      if (!cancelled && res.count > 0) {
        toast.success(`Se ${res.count === 1 ? 'registró' : 'registraron'} ${res.count} transacción${res.count === 1 ? '' : 'es'} recurrente${res.count === 1 ? '' : 's'}`);
      }
    })();
    return () => { cancelled = true; };
  }, [user, fetchRecurring, materializeDue]);

  // Restaurar título por defecto cuando no hay sesión.
  useEffect(() => {
    if (isPublic) document.title = DEFAULT_TITLE;
  }, [isPublic]);

  // Cargando sesión de Supabase: spinner neutral sin tocar la URL.
  if (loading && !demo) {
    return <LoadingScreen label="Cargando aplicación…" />;
  }

  // Sin sesión: redirigir a / para limpiar cualquier URL residual, luego
  // mostrar landing o auth desde la ruta raíz.
  if (isPublic) {
    if (location.pathname !== '/') {
      return <Navigate to="/" replace />;
    }
    const showLanding = !isRecoveringPassword && !showAuth;
    return showLanding
      ? <StitchLanding onAccess={() => setShowAuth(true)} />
      : <StitchAuth />;
  }

  // Gate de moneda: usuario real y modo "usuario nuevo" (fresh) ven el onboarding
  // bloqueante. El demo establecido lo salta (ya trae moneda sembrada).
  const showCurrencyOnboarding = (!demo || fresh) && prefsLoaded && !currency;

  // App autenticada: renderizar las rutas protegidas.
  return (
    <>
      <Routes>
        <Route element={<StitchShell />}>
          <Route index element={<StitchDashboard />} />
          <Route path="transacciones" element={<StitchLedger />} />
          <Route path="presupuesto" element={<StitchBudget />} />
          <Route path="mis-finanzas" element={<StitchFinances />} />
          <Route path="ahorros" element={<Navigate to="/mis-finanzas?tab=vaults" replace />} />
          <Route path="deudas" element={<Navigate to="/mis-finanzas?tab=debts" replace />} />
          <Route path="tarjetas" element={<Navigate to="/mis-finanzas?tab=cards" replace />} />
          <Route path="calendario" element={<StitchCalendar />} />
          <Route path="categorias" element={<StitchCategories />} />
          <Route path="ajustes" element={<StitchSettings />} />
          <Route path="feedback" element={<StitchFeedback />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      {showCurrencyOnboarding && <CurrencyOnboarding />}
    </>
  );
}

export default function StitchApp() {
  return (
    <>
      <StitchHead />
      <Toaster {...toasterOptions} />
      <BrowserRouter>
        {/* Suspense para la PRIMERA carga de un chunk lazy (arranque). Las
            navegaciones posteriores no pasan por aquí: van en transición. */}
        <Suspense fallback={<LoadingScreen label="Cargando aplicación…" />}>
          <AuthGate />
        </Suspense>
      </BrowserRouter>
    </>
  );
}
