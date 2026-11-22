import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useI18n } from '../contexts/I18nContext';

const DEFAULT_TITLE = 'FinTrack — Presupuesto y Control de Gastos';

// Clave i18n del nombre de cada ruta; el título es "<nombre> · FinTrack".
const ROUTE_KEYS = {
  '/': 'nav.dashboard',
  '/transacciones': 'nav.transactions',
  '/presupuesto': 'nav.budget',
  '/mis-finanzas': 'nav.finances',
  '/proyeccion': 'nav.projection',
  '/calendario': 'nav.calendar',
  '/categorias': 'nav.categories',
  '/ajustes': 'nav.settings',
  '/feedback': 'nav.feedback',
};

export function usePageTitle(fallback = DEFAULT_TITLE) {
  const { pathname } = useLocation();
  const { t, language } = useI18n();
  useEffect(() => {
    const key = ROUTE_KEYS[pathname];
    document.title = key ? `${t(key)} · FinTrack` : fallback;
    return () => { document.title = DEFAULT_TITLE; };
  }, [pathname, fallback, t, language]);
}

export { DEFAULT_TITLE };
