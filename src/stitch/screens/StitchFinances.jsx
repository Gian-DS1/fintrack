// Mis finanzas — unifica Patrimonio (resumen) + Ahorros/Deudas/Tarjetas (tabs).
// Cada panel es la pantalla existente con prop embedded (sin su <div> raíz ni su
// total de header: el total vive en el resumen). Solo se monta el panel activo.
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import PatrimonioSummary from './finances/PatrimonioSummary';
import StitchVaults from './StitchVaults';
import StitchDebts from './StitchDebts';
import StitchCards from './StitchCards';
import { useI18n } from '../../contexts/I18nContext';
import { EASE_OUT } from '../motionTokens';

// Tarjetas primero: es lo que el usuario consulta con más frecuencia, así que
// es la pestaña que aparece por defecto al entrar a Mis finanzas.
const TABS = ['cards', 'vaults', 'debts'];

export default function StitchFinances() {
  const { t } = useI18n();
  const reduced = useReducedMotion();
  const [params] = useSearchParams();
  const initial = TABS.includes(params.get('tab')) ? params.get('tab') : 'cards';
  const [tab, setTab] = useState(initial);

  const tabLabels = {
    vaults: t('finances.tabSavings'),
    debts: t('finances.tabDebts'),
    cards: t('finances.tabCards'),
  };

  return (
    <div className="p-md sm:p-margin-safe max-w-[1728px] mx-auto w-full">
      <h1 className="sr-only">{t('finances.title')}</h1>
      <PatrimonioSummary />

      {/* Tabs */}
      <div className="flex gap-xs border-b border-border-subtle mb-lg">
        {TABS.map((id) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-md py-sm font-label-sm text-label-sm uppercase tracking-widest border-b-2 -mb-px transition-colors ${
              tab === id
                ? 'border-primary text-primary'
                : 'border-transparent text-on-surface-variant hover:text-on-surface'
            }`}
          >
            {tabLabels[id]}
          </button>
        ))}
      </div>

      {/* Panel activo (solo se monta uno). Fade/scale suave al cambiar. */}
      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={reduced ? false : { opacity: 0, scale: 0.99 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={reduced ? undefined : { opacity: 0, scale: 0.99 }}
          transition={{ duration: 0.16, ease: EASE_OUT }}
        >
          {tab === 'vaults' && <StitchVaults />}
          {tab === 'debts' && <StitchDebts />}
          {tab === 'cards' && <StitchCards />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
