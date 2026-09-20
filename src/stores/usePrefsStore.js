// FinTrack — Preferencias del usuario (híbrido Supabase + caché local).
//
// budgetLevel: nivel de presupuesto elegido por el usuario.
//   'tracking' (Seguimiento) | '503020' (regla 50/30/20) | 'zero' (base cero).
//   Default para usuarios nuevos = 'tracking' (la entrada más simple).
//
// Persistencia: caché local con persist (para que aplique al instante y funcione
// en modo demo/QA sin sesión) + tabla `profiles` en Supabase como fuente de verdad
// cuando hay sesión. En demo NUNCA toca Supabase. fetchPrefs sobrescribe el caché
// con el valor de Supabase al cargar (igual que fetchBudgets reemplaza budgets).

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { supabase, getCurrentUser } from '../lib/supabase';
import { isDemoActive } from '../stitch/demoMode';
import { setRuntimeCurrency } from '../utils/currencyRuntime';

const BUDGET_LEVELS = ['tracking', '503020', 'zero'];
const DEFAULT_LEVEL = 'tracking';

// Recordatorios de pago de tarjetas por correo. Los días de antelación son
// configurables; el aviso del día del vencimiento y los de mora van siempre
// (ver src/utils/cardReminders.js, que es quien decide a quién avisar).
const DEFAULT_REMINDER_DAYS = [5, 1];

// Normaliza la lista de antelaciones: enteros únicos en 1..30, máximo 3.
// Devuelve null si la entrada no sirve, para no pisar el valor guardado.
function normalizeReminderDays(days) {
  if (!Array.isArray(days)) return null;
  const clean = [...new Set(
    days.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 30),
  )].sort((a, b) => b - a).slice(0, 3);
  return clean.length ? clean : null;
}

const usePrefsStore = create(
  persist(
    (set, get) => ({
      budgetLevel: DEFAULT_LEVEL,
      // ¿El usuario ya vio el tutorial guiado? Controla el auto-arranque (solo la
      // 1ª vez). En demo vive solo en caché local; con sesión, en profiles.
      tutorialSeen: false,
      currency: null,
      loading: false,
      // ¿Ya resolvió fetchPrefs al menos una vez? El auto-arranque del tutorial
      // espera a esto para no decidir con el caché provisional (evita disparar el
      // tour a quien ya lo vio en otro dispositivo, y evita la carrera con OAuth
      // donde loading hace false→true→false tras el primer paint).
      prefsLoaded: false,
      // Efectivo líquido inicial declarado por el usuario (modo demo). NO se
      // persiste (no está en partialize) ni se sincroniza a Supabase en esta fase.
      initialCashBalance: 0,
      // Recordatorios de pago por correo. Default activados: el usuario pidió
      // la función explícitamente (ver supabase/add_card_reminders.sql).
      remindersEnabled: true,
      reminderDaysBefore: DEFAULT_REMINDER_DAYS,

      /** Carga prefs desde Supabase (si hay sesión). Sin sesión deja el caché. */
      fetchPrefs: async () => {
        if (isDemoActive()) { set({ prefsLoaded: true }); return; } // demo: solo caché local
        const user = await getCurrentUser();
        if (!user) { set({ prefsLoaded: true }); return; }
        set({ loading: true });
        const { data, error } = await supabase
          .from('profiles')
          .select('budget_level, tutorial_seen, currency, initial_cash_balance, reminders_enabled, reminder_days_before')
          .eq('user_id', user.id)
          .maybeSingle();
        if (!error && data) {
          const next = { loading: false, prefsLoaded: true };
          if (data.budget_level && BUDGET_LEVELS.includes(data.budget_level)) next.budgetLevel = data.budget_level;
          if (typeof data.tutorial_seen === 'boolean') next.tutorialSeen = data.tutorial_seen;
          // Reset explícito a 0 si el perfil no tiene valor: evita que un usuario
          // herede el efectivo inicial del usuario anterior en el mismo navegador
          // (mismo patrón que currency arriba).
          if (data.initial_cash_balance != null) next.initialCashBalance = Number(data.initial_cash_balance);
          else next.initialCashBalance = 0;
          // Mismo reset explícito que arriba: un usuario nuevo no hereda la
          // configuración de recordatorios del usuario anterior del navegador.
          if (typeof data.reminders_enabled === 'boolean') next.remindersEnabled = data.reminders_enabled;
          else next.remindersEnabled = true;
          next.reminderDaysBefore = normalizeReminderDays(data.reminder_days_before) || DEFAULT_REMINDER_DAYS;
          if (data.currency) {
            next.currency = data.currency;
            setRuntimeCurrency(data.currency);
          } else {
            // Perfil sin moneda elegida: resetea (un usuario nuevo no debe
            // heredar el runtime del usuario/caché anterior).
            next.currency = null;
            setRuntimeCurrency(null);
          }
          set(next);
        } else {
          // Usuario nuevo sin fila en profiles (data null): tutorialSeen queda
          // en false → el tutorial debe arrancar.
          set({ loading: false, prefsLoaded: true });
        }
      },

      /** Marca el tutorial como visto (optimista). En demo solo caché. */
      setTutorialSeen: async (seen = true) => {
        const prev = get().tutorialSeen;
        set({ tutorialSeen: seen }); // optimista
        if (isDemoActive()) return;
        const user = await getCurrentUser();
        if (!user) return; // sin sesión, solo caché local
        const { error } = await supabase
          .from('profiles')
          .upsert({ user_id: user.id, tutorial_seen: seen, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
        if (error) {
          if (import.meta.env.DEV) console.error('Error guardando tutorial_seen:', error);
          set({ tutorialSeen: prev }); // rollback
        }
      },

      /** Cambia el nivel (optimista). En demo solo caché; con sesión hace upsert. */
      setBudgetLevel: async (level) => {
        if (!BUDGET_LEVELS.includes(level)) return;
        const prev = get().budgetLevel;
        set({ budgetLevel: level }); // optimista
        if (isDemoActive()) return;
        const user = await getCurrentUser();
        if (!user) return; // sin sesión, solo caché local
        const { error } = await supabase
          .from('profiles')
          .upsert({ user_id: user.id, budget_level: level, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
        if (error) {
          if (import.meta.env.DEV) console.error('Error guardando nivel de presupuesto:', error);
          set({ budgetLevel: prev }); // rollback
        }
      },

      /** Fija la moneda del usuario (optimista). En demo solo caché. */
      setCurrency: async (code) => {
        const c = typeof code === 'string' ? code.trim().toUpperCase() : '';
        if (!/^[A-Z]{3}$/.test(c)) return;
        const prev = get().currency;
        set({ currency: c });
        setRuntimeCurrency(c);
        if (isDemoActive()) return;
        const user = await getCurrentUser();
        if (!user) return;
        const { error } = await supabase
          .from('profiles')
          .upsert({ user_id: user.id, currency: c, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
        if (error) {
          if (import.meta.env.DEV) console.error('Error guardando moneda:', error);
          set({ currency: prev });
          setRuntimeCurrency(prev);
        }
      },

      /** Fija el efectivo inicial (optimista). En demo solo caché; con sesión upsert. */
      setInitialCashBalance: async (amount) => {
        const value = Number(amount) || 0;
        const prev = get().initialCashBalance;
        set({ initialCashBalance: value }); // optimista
        if (isDemoActive()) return; // demo: solo memoria
        const user = await getCurrentUser();
        if (!user) return; // sin sesión, solo caché local
        const { error } = await supabase
          .from('profiles')
          .upsert({ user_id: user.id, initial_cash_balance: value, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
        if (error) {
          if (import.meta.env.DEV) console.error('Error guardando efectivo inicial:', error);
          set({ initialCashBalance: prev }); // rollback
        }
      },

      /** Activa/desactiva los recordatorios por correo (optimista). */
      setRemindersEnabled: async (enabled) => {
        const value = Boolean(enabled);
        const prev = get().remindersEnabled;
        set({ remindersEnabled: value }); // optimista
        if (isDemoActive()) return; // demo: solo memoria
        const user = await getCurrentUser();
        if (!user) return; // sin sesión, solo caché local
        const { error } = await supabase
          .from('profiles')
          .upsert({ user_id: user.id, reminders_enabled: value, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
        if (error) {
          if (import.meta.env.DEV) console.error('Error guardando recordatorios:', error);
          set({ remindersEnabled: prev }); // rollback
        }
      },

      /** Fija los días de antelación del aviso (optimista). */
      setReminderDaysBefore: async (days) => {
        const value = normalizeReminderDays(days);
        if (!value) return; // entrada inválida: no se pisa lo guardado
        const prev = get().reminderDaysBefore;
        set({ reminderDaysBefore: value }); // optimista
        if (isDemoActive()) return;
        const user = await getCurrentUser();
        if (!user) return;
        const { error } = await supabase
          .from('profiles')
          .upsert({ user_id: user.id, reminder_days_before: value, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
        if (error) {
          if (import.meta.env.DEV) console.error('Error guardando días de antelación:', error);
          set({ reminderDaysBefore: prev }); // rollback
        }
      },
    }),
    {
      name: 'fintrack-prefs-cache',
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({ budgetLevel: state.budgetLevel, tutorialSeen: state.tutorialSeen, currency: state.currency, initialCashBalance: state.initialCashBalance, remindersEnabled: state.remindersEnabled, reminderDaysBefore: state.reminderDaysBefore }),
      onRehydrateStorage: () => (state) => { if (state?.currency) setRuntimeCurrency(state.currency); },
    },
  ),
);

export default usePrefsStore;
