// AppShell Stitch — sidebar + header glass, responsive.
// Desktop: sidebar fijo 256px. Móvil (<lg): sidebar off-canvas + hamburguesa + overlay.

import { useEffect, useRef, useState } from 'react';
import { NavLink, useOutlet, useLocation } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import MS from './MS';
import Logo from './Logo';
import { Screen } from './StitchMotion';
import AccountMenu from './AccountMenu';
import LanguageSelector from './LanguageSelector';
import TourProvider from './tour/TourProvider';
import { useTour } from './tour/useTour';
import { useAuth } from '../contexts/AuthContext';
import { isDemoActive, exitDemo } from './demoMode';
import usePrefsStore from '../stores/usePrefsStore';
import { usePageTitle } from './usePageTitle';
import { useI18n } from '../contexts/I18nContext';

// NAV se genera dinámicamente en el componente para usar las traducciones

// Arranca el tutorial automáticamente la 1ª vez (cuando el usuario aún no lo ha
// visto). Vive dentro de TourProvider para usar start(). Una sola vez por sesión.
//
// Importante (bug de carrera con login de Google): antes este effect dependía de
// `loading` y devolvía un cleanup que hacía clearTimeout. Con OAuth, fetchPrefs
// resuelve DESPUÉS del primer paint: loading hacía false→true→false, y el cambio
// a true ejecutaba el cleanup del render previo CANCELANDO el setTimeout ya
// programado; como `fired` ya estaba marcado, no se reprogramaba y el tour nunca
// aparecía. La corrección: solo programamos el timeout cuando loading ya es false
// y tutorialSeen es false, y NO lo cancelamos por cambios posteriores de estado
// (el guard `fired` garantiza que sea una sola vez). El timeout solo se limpia al
// desmontar el componente de verdad.
function TourAutoStart() {
  const { start } = useTour();
  const tutorialSeen = usePrefsStore((s) => s.tutorialSeen);
  const prefsLoaded = usePrefsStore((s) => s.prefsLoaded);
  // El onboarding de moneda va primero; el tour espera a que currency esté elegida.
  const currency = usePrefsStore((s) => s.currency);
  const fired = useRef(false);
  const timerRef = useRef(null);

  useEffect(() => {
    if (fired.current) return;
    // Esperar a que fetchPrefs resuelva (prefsLoaded) para decidir con el valor
    // real de Supabase, no con el caché provisional. Así no parpadea para quien ya
    // lo vio en otro dispositivo ni se pierde el arranque por la carrera con OAuth.
    if (!prefsLoaded) return;
    // No arrancar el tour si el usuario aún no ha elegido moneda: el gate
    // CurrencyOnboarding (z-50) debe resolverse primero. En demo, seedDemoStores
    // fija currency='DOP', así que el tour demo sigue funcionando con este guard.
    if (!currency) return;
    if (!tutorialSeen) {
      fired.current = true;
      // Pequeño delay para que el shell pinte antes de medir anclas.
      timerRef.current = setTimeout(() => start(), 700);
    }
  }, [tutorialSeen, prefsLoaded, currency, start]);

  // Limpia el timeout solo al desmontar (no en cada cambio de loading/seen), para
  // que un re-render intermedio no cancele un arranque ya programado.
  useEffect(() => () => clearTimeout(timerRef.current), []);

  return null;
}

export default function StitchShell() {
  return (
    <TourProvider>
      <TourAutoStart />
      <ShellInner />
    </TourProvider>
  );
}

function ShellInner() {
  const { signOut } = useAuth();
  const { t } = useI18n();
  const demo = isDemoActive();
  const [menuOpen, setMenuOpen] = useState(false);
  // Colapso del sidebar en desktop (solo iconos). Se recuerda en localStorage.
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('fintrack-nav-collapsed') === '1'; } catch { return false; }
  });
  const toggleCollapsed = () => setCollapsed((c) => {
    const next = !c;
    try { localStorage.setItem('fintrack-nav-collapsed', next ? '1' : '0'); } catch { /* ignore */ }
    return next;
  });
  const outlet = useOutlet();
  const location = useLocation();
  usePageTitle();

  // El colapso a "solo iconos" es una preferencia de ESCRITORIO. En móvil el
  // drawer abierto (menuOpen) siempre muestra las etiquetas: un menú de solo
  // iconos a pantalla completa no se entiende y el ancho ya lo fuerza a 256px.
  const iconOnly = collapsed && !menuOpen;

  const handleSignOut = () => {
    if (demo) { exitDemo(); window.location.reload(); return; }
    signOut();
  };

  const NAV = [
    { section: t('nav.section.main') },
    { to: '/', icon: 'dashboard', label: t('nav.dashboard'), end: true },
    { to: '/transacciones', icon: 'list_alt', label: t('nav.transactions') },
    { to: '/presupuesto', icon: 'account_balance', label: t('nav.budget') },
    { section: t('nav.section.assets') },
    { to: '/mis-finanzas', icon: 'account_balance_wallet', label: t('nav.finances') },
    { to: '/proyeccion', icon: 'insights', label: t('nav.projection') },
    { section: t('nav.section.tools') },
    { to: '/calendario', icon: 'calendar_month', label: t('nav.calendar') },
    { to: '/categorias', icon: 'sell', label: t('nav.categories') },
  ];

  return (
    <div className="stitch-root stitch-shell-height flex overflow-hidden grid-pattern bg-surface-background font-body-md text-body-md text-on-surface">
      {/* Overlay móvil */}
      {menuOpen && (
        <div className="fixed inset-0 bg-black/60 z-30 lg:hidden" onClick={() => setMenuOpen(false)} aria-hidden="true" />
      )}

      {/* ── SideNav ── */}
      <nav
        data-tour="nav"
        className={[
          // OJO: no mezclar utilidades de position en el mismo breakpoint. Antes
          // había 'relative' + 'fixed' juntas: ganaba relative (orden del CSS
          // generado) y el sidebar "off-canvas" seguía ocupando sitio en el flex,
          // corriendo todo el contenido móvil ~75px a la derecha. En móvil es
          // fixed (fuera de flujo); en lg+ vuelve al flujo como lg:relative
          // (relative, no static, para anclar el handle absoluto de colapso).
          'bg-surface-panel h-full border-r border-border-subtle flex flex-col py-lg gap-xs shrink-0',
          'fixed inset-y-0 left-0 z-40 transition-[transform,width] duration-300 lg:relative lg:translate-x-0',
          iconOnly ? 'lg:w-[72px] px-sm' : 'w-64 px-md',
          menuOpen ? 'translate-x-0 w-64 px-md' : '-translate-x-full',
        ].join(' ')}
      >
        <div className={`mb-lg flex items-center ${iconOnly ? 'justify-center px-0' : 'justify-between px-sm'}`}>
          {iconOnly ? (
            <Logo size={26} />
          ) : (
            <div className="min-w-0">
              <Logo size={26} withText />
              <div className="text-text-muted font-label-sm text-label-sm pl-[34px] -mt-xs">{t('nav.tagline')}</div>
            </div>
          )}
          {/* Cerrar en móvil */}
          <button onClick={() => setMenuOpen(false)} className="lg:hidden text-text-muted hover:text-on-surface p-xs tap-target" aria-label={t('shell.closeMenu')}>
            <MS name="close" className="text-[20px]" />
          </button>
        </div>

        <div className="flex flex-col gap-xs flex-grow overflow-y-auto overflow-x-hidden">
          {NAV.map((item, i) =>
            item.section ? (
              iconOnly ? (
                <div key={`s-${i}`} className="h-px bg-border-subtle mx-sm my-sm" />
              ) : (
                <div key={`s-${i}`} className="font-mono-data text-mono-data text-text-muted uppercase tracking-[0.18em] px-md pt-md pb-xs">
                  {item.section}
                </div>
              )
            ) : (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={() => setMenuOpen(false)}
                title={iconOnly ? item.label : undefined}
                className={({ isActive }) =>
                  [
                    'flex items-center gap-md py-sm rounded transition-all duration-200 border',
                    iconOnly ? 'justify-center px-0' : 'px-md',
                    isActive
                      ? 'bg-surface-container-highest text-primary border-border-subtle font-bold shadow-[0_0_15px_rgba(190,194,255,0.2)]'
                      : 'text-on-surface-variant border-transparent hover:text-on-surface hover:bg-surface-container-highest',
                  ].join(' ')
                }
              >
                {({ isActive }) => (
                  <>
                    <MS name={item.icon} fill={isActive} className="text-[20px] shrink-0" />
                    {!iconOnly && <span className="font-label-sm text-label-sm truncate">{item.label}</span>}
                  </>
                )}
              </NavLink>
            )
          )}
        </div>

        <button
          onClick={handleSignOut}
          title={iconOnly ? t('auth.signOut') : undefined}
          className={`mt-md w-full py-sm bg-transparent border border-border-subtle text-on-surface-variant font-label-sm text-label-sm rounded hover:bg-surface-container-high hover:text-accent-error transition-colors flex items-center gap-sm ${iconOnly ? 'justify-center px-0' : 'justify-center'}`}
        >
          <MS name="logout" className="text-[16px] shrink-0" />{!iconOnly && <span>{t('auth.signOut')}</span>}
        </button>

        {/* Handle de colapso: pestaña discreta en el borde derecho del sidebar
            (solo desktop). Tenue por defecto, se resalta al hover. Sin texto. */}
        <button
          onClick={toggleCollapsed}
          title={collapsed ? t('shell.expandMenu') : t('shell.collapseMenu')}
          aria-label={collapsed ? t('shell.expandMenu') : t('shell.collapseMenu')}
          className="hidden lg:flex absolute top-1/2 -right-3 -translate-y-1/2 z-50 h-12 w-6 items-center justify-center rounded-full border border-border-subtle bg-surface-container text-text-muted opacity-40 hover:opacity-100 hover:text-on-surface hover:bg-surface-container-high transition-[opacity,color,background-color] duration-200 active:scale-95"
        >
          <MS name={collapsed ? 'chevron_right' : 'chevron_left'} className="text-[18px]" />
        </button>
      </nav>

      {/* ── Main ── */}
      <div className="flex flex-col flex-grow h-full overflow-hidden relative min-w-0">
        <header className="bg-surface-background sticky top-0 z-10 border-b border-border-subtle w-full h-16 flex justify-between items-center px-md sm:px-margin-safe inner-glow shrink-0 gap-sm">
          <div className="flex items-center gap-sm min-w-0">
            <button onClick={() => setMenuOpen(true)} className="lg:hidden text-on-surface-variant hover:text-on-surface p-sm -ml-sm" aria-label={t('shell.openMenu')}>
              <MS name="menu" className="text-[24px]" />
            </button>
            <div className="font-headline-md text-headline-md font-bold text-on-surface truncate">FinTrack</div>
            {demo && (
              <span className="font-mono-data text-mono-data text-accent-warning uppercase tracking-widest border border-accent-warning/40 rounded px-sm py-xs hidden sm:inline">
                Demo · QA
              </span>
            )}
          </div>
          <div className="flex-1" />
          <div className="flex items-center shrink-0 gap-sm">
            <LanguageSelector />
            <AccountMenu />
          </div>
        </header>

        <main className="flex-grow overflow-y-auto overflow-x-hidden pb-[env(safe-area-inset-bottom)]">
          <AnimatePresence mode="wait" initial={false}>
            <Screen key={location.pathname}>{outlet}</Screen>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
