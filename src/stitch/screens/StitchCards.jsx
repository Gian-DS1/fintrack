// Tarjetas — shell: header + grid de tarjetas (CardItem) + modales. La lógica de
// saldos/abonos/cashback ya vive en utils/creditCards.js y el store.
import { useState } from 'react';
import { toastUndo } from '../toastUndo';
import MS from '../MS';
import { Stagger } from '../StitchMotion';
import useCreditCardStore from '../../stores/useCreditCardStore';
import useTransactionStore from '../../stores/useTransactionStore';
import { isDemoActive, demoDeleteCard, demoRestoreCard } from '../demoMode';
import { useI18n } from '../../contexts/I18nContext';
import { tr } from '../../i18n/runtime';
import CardItem from './cards/CardItem';
import CardForm from './cards/CardForm';
import PaymentModal from './cards/PaymentModal';
import HistoryModal from './cards/HistoryModal';

export default function StitchCards({ embedded = false }) {
  const { t } = useI18n();
  const { cards, addCard, deleteCard } = useCreditCardStore();
  const { transactions } = useTransactionStore();

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [payCard, setPayCard] = useState(null);
  const [historyCard, setHistoryCard] = useState(null);

  const openCreate = () => { setEditing(null); setShowForm(true); };
  const openEdit = (c) => { setEditing(c); setShowForm(true); };

  const onDelete = (card) => {
    if (isDemoActive()) demoDeleteCard(card.id); else deleteCard(card.id);
    toastUndo(tr('screens.cards.cardDeleted'), () => {
      if (isDemoActive()) demoRestoreCard(card); else addCard(card);
    });
  };

  return (
    <div className={embedded ? '' : 'p-md sm:p-margin-safe max-w-[1728px] mx-auto w-full'}>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-xl gap-md">
        <div>
          <div className="flex items-center gap-sm mb-xs">
            <span className="w-2 h-2 rounded-full bg-secondary live-dot" />
            <span className="font-mono-data text-mono-data text-secondary uppercase tracking-wider">{t('pages.activeCards')}</span>
          </div>
          <h1 className="font-headline-lg text-headline-lg text-on-surface">{t('pages.creditCards')}</h1>
          <p className="font-body-md text-body-md text-text-muted mt-sm">{t('screens.cards.subtitle')}</p>
        </div>
        <button data-tour="cards-new" onClick={openCreate} className="bg-primary text-on-primary font-label-sm text-label-sm uppercase tracking-widest font-bold px-md py-sm rounded hover:bg-primary-container transition-colors inner-glow flex items-center gap-xs">
          <MS name="add" className="text-[16px]" /> {t('common.newCard')}
        </button>
      </div>

      {cards.length === 0 ? (
        <Empty onAdd={openCreate} />
      ) : (
        <Stagger className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-md">
          {cards.map((card) => (
            <CardItem
              key={card.id}
              card={card}
              transactions={transactions}
              onPay={setPayCard}
              onHistory={setHistoryCard}
              onEdit={openEdit}
              onDelete={onDelete}
            />
          ))}
        </Stagger>
      )}

      {showForm && <CardForm editing={editing} onClose={() => setShowForm(false)} />}
      {payCard && <PaymentModal card={payCard} transactions={transactions} onClose={() => setPayCard(null)} />}
      {historyCard && <HistoryModal card={historyCard} transactions={transactions} onClose={() => setHistoryCard(null)} />}
    </div>
  );
}

function Empty({ onAdd }) {
  const { t } = useI18n();
  return (
    <div className="bg-surface-card border border-border-subtle rounded-lg inner-glow py-[60px] flex flex-col items-center gap-sm text-center">
      <MS name="credit_card" className="text-[36px] text-text-muted" />
      <p className="font-body-md text-body-md text-on-surface-variant">{t('screens.cards.noCardsYet')}</p>
      <button onClick={onAdd} className="mt-sm bg-primary text-on-primary font-label-sm text-label-sm uppercase tracking-widest px-md py-sm rounded">{t('creditCards.addCard')}</button>
    </div>
  );
}
