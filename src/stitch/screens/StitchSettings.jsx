// Ajustes — nivel de presupuesto, moneda, idioma, export/import, categorías. Estilo Stitch.
import { useState, useRef, useMemo } from 'react';
import toast from 'react-hot-toast';
import MS from '../MS';
import { Stagger } from '../StitchMotion';
import { isDemoActive } from '../demoMode';
import { useI18n } from '../../contexts/I18nContext';
import useTransactionStore from '../../stores/useTransactionStore';
import useCategoryStore from '../../stores/useCategoryStore';
import usePrefsStore from '../../stores/usePrefsStore';
import { autoCategorize } from '../../data/defaultCategories';
import { getCurrency } from '../../utils/currencyRuntime';
import { todayISO, toISODate, formatCurrency } from '../../utils/formatters';
import { currencyOptions } from '../../utils/currencyOptions';
import StitchSelect from '../StitchSelect';
import StitchCurrencyInput from '../StitchCurrencyInput';
import StatementImportModal from './StatementImportModal';
import { demoSetInitialCashBalance, demoSetRemindersEnabled, demoSetReminderDaysBefore } from '../demoMode';
import { supabase } from '../../lib/supabase';

export default function StitchSettings() {
  const { t, language } = useI18n();

  // Niveles de presupuesto (de más simple a más avanzado).
  // Presets de antelación del recordatorio. Tres opciones cubren el caso real;
  // un selector libre de días sería más flexible y bastante menos usable.
  const REMINDER_PRESETS = [
    { key: 'remindersDays51', days: [5, 1] },
    { key: 'remindersDays3', days: [3] },
    { key: 'remindersDays1', days: [1] },
  ];

  const BUDGET_LEVEL_CARDS = [
    { value: 'tracking', icon: 'visibility', title: t('screens.budget.trackingMode'), desc: t('screens.settings.levelTrackingDesc') },
    { value: '503020', icon: 'pie_chart', title: t('screens.settings.rule503020'), desc: t('screens.settings.level503020Desc') },
    { value: 'zero', icon: 'account_balance_wallet', title: t('screens.budget.zeroMode'), desc: t('screens.settings.levelZeroDesc') },
  ];

  const { transactions, bulkAddTransactions } = useTransactionStore();
  const { categories } = useCategoryStore();
  const fileRef = useRef(null);
  const pdfRef = useRef(null);
  const [pdfData, setPdfData] = useState(null);
  const [parsingPdf, setParsingPdf] = useState(false);
  const demo = isDemoActive();

  // Anti CSV/XLSX formula injection: Excel ejecuta celdas que empiezan con = + - @.
  const safeCell = (v) => (/^[=+\-@]/.test(String(v ?? '')) ? `'${v}` : v);

  // Export únicamente a Excel (.xlsx). El export CSV se retiró: duplicaba la
  // acción y el .xlsx cubre el mismo caso con mejor compatibilidad.
  const doExport = async () => {
    if (transactions.length === 0) { toast.error(t('screens.settings.nothingToExport')); return; }
    if (!window.confirm(t('screens.settings.confirmExport'))) return;
    const data = transactions.map((t) => {
      const cat = categories.find((c) => c.id === t.categoryId);
      return { Fecha: t.date, Descripción: safeCell(t.description), Categoría: safeCell(cat ? cat.name : ''), Monto: t.amount, Tipo: t.type === 'income' ? 'Ingreso' : 'Gasto', Moneda: t.currency, Notas: safeCell(t.notes || '') };
    });
    const stamp = todayISO();
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.json_to_sheet(data); const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Transacciones'); XLSX.writeFile(wb, `FinTrack_Export_${stamp}.xlsx`);
    toast.success(t('screens.settings.excelExported'));
  };

  const onFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (isDemoActive()) { toast(t('screens.settings.importNotInDemo'), { icon: 'ℹ️' }); e.target.value = ''; return; }
    const ext = file.name.split('.').pop().toLowerCase();
    const process = async (rows) => {
      const txs = rows.map((row) => {
        const date = row['Fecha'] || row['Date'] || row['fecha'];
        const desc = row['Descripción'] || row['Description'] || row['Concepto'] || row['descripcion'];
        const raw = row['Monto'] || row['Amount'] || row['monto'];
        const typeStr = row['Tipo'] || row['Type'] || row['tipo'] || '';
        if (!date || !raw) return null;
        const amount = Math.abs(parseFloat(String(raw).replace(/[^\d.-]/g, '')));
        if (isNaN(amount) || amount === 0) return null;
        let type = 'expense';
        if (String(typeStr).toLowerCase().includes('ingreso') || String(typeStr).toLowerCase().includes('income') || String(raw).trim().startsWith('+')) type = 'income';
        // ISO local SIEMPRE (toISOString corre el día fuera de UTC, p. ej. GMT-4).
        let fdate = todayISO();
        try {
          if (typeof date === 'number') {
            // Serial de Excel: días desde 1899-12-30, en calendario local.
            const d = new Date(1899, 11, 30);
            d.setDate(d.getDate() + Math.floor(date));
            fdate = toISODate(d);
          } else if (/^\d{4}-\d{2}-\d{2}/.test(String(date).trim())) {
            fdate = String(date).trim().slice(0, 10);
          } else {
            const d = new Date(date);
            if (!isNaN(d.getTime())) fdate = toISODate(d);
          }
        } catch { /* ignore */ }
        const match = autoCategorize(String(desc), categories);
        return { date: fdate, amount, type, description: String(desc).slice(0, 500).replace(/[<>]/g, '') || t('screens.settings.imported'), categoryId: match ? match.id : '', currency: getCurrency(), notes: null };
      }).filter(Boolean);
      if (txs.length === 0) { toast.error(t('screens.settings.noValidRows')); return; }
      const n = await bulkAddTransactions(txs);
      toast.success(t('screens.settings.importedN').replace('{n}', n));
    };
    if (ext === 'csv') {
      import('papaparse').then(({ default: Papa }) => Papa.parse(file, { header: true, skipEmptyLines: true, complete: (r) => process(r.data), error: () => toast.error(t('screens.settings.csvReadError')) }));
    } else if (ext === 'xlsx' || ext === 'xls') {
      import('xlsx').then((XLSX) => {
        const reader = new FileReader();
        reader.onload = (ev) => { try { const wb = XLSX.read(ev.target.result, { type: 'array' }); process(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]])); } catch { toast.error(t('screens.settings.excelReadError')); } };
        reader.readAsArrayBuffer(file);
      });
    } else toast.error(t('screens.settings.unsupportedFormat'));
    e.target.value = '';
  };

  const onPdfFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (isDemoActive()) { toast(t('screens.settings.importNotInDemo'), { icon: 'ℹ️' }); e.target.value = ''; return; }

    setParsingPdf(true);
    const toastId = toast.loading(t('screens.settings.extractingStatement'));
    try {
      const reader = new FileReader();
      reader.onload = async (ev) => {
        try {
          const base64 = ev.target.result.split(',')[1];
          const { data: { session } } = await supabase.auth.getSession();
          const token = session?.access_token;

          const res = await fetch('/api/parse-pdf', {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ pdfBase64: base64 })
          });
          
          if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || t('screens.settings.pdfParseError'));
          }
          const data = await res.json();
          setPdfData(data);
          toast.success(t('screens.settings.foundConsumptions').replace('{n}', data.count).replace('{bank}', data.bank), { id: toastId });
        } catch (err) {
          toast.error(err.message, { id: toastId });
        } finally {
          setParsingPdf(false);
          e.target.value = '';
        }
      };
      reader.onerror = () => { toast.error(t('screens.settings.localFileError'), { id: toastId }); setParsingPdf(false); e.target.value = ''; };
      reader.readAsDataURL(file);
    } catch (err) {
      toast.error(err.message, { id: toastId });
      setParsingPdf(false);
      e.target.value = '';
    }
  };

  const budgetLevel = usePrefsStore((s) => s.budgetLevel);
  const setBudgetLevel = usePrefsStore((s) => s.setBudgetLevel);
  const currency = usePrefsStore((s) => s.currency);
  const setCurrency = usePrefsStore((s) => s.setCurrency);
  const initialCashBalance = usePrefsStore((s) => s.initialCashBalance);
  const setInitialCashBalance = usePrefsStore((s) => s.setInitialCashBalance);
  const remindersEnabled = usePrefsStore((s) => s.remindersEnabled);
  const setRemindersEnabled = usePrefsStore((s) => s.setRemindersEnabled);
  const reminderDaysBefore = usePrefsStore((s) => s.reminderDaysBefore);
  const setReminderDaysBefore = usePrefsStore((s) => s.setReminderDaysBefore);

  // Fix 2: memoizar opciones de moneda; se recalcula sólo si cambia el idioma.
  // Derivamos el locale a partir de `language` (misma lógica que currentLocale())
  // para que ESLint pueda verificar la dep sin falsos warnings.
  const locale = language === 'es' ? 'es-DO' : 'en-US';
  const currencyOpts = useMemo(() => currencyOptions(locale), [locale]);

  return (
    <div className="p-md sm:p-margin-safe max-w-[1728px] mx-auto w-full">
      <div className="mb-xl">
        <div className="flex items-center gap-sm mb-xs">
          <span className="font-mono-data text-mono-data text-on-surface-variant uppercase">{t('screens.settings.configuration')}</span>
        </div>
        <h1 className="font-headline-lg text-headline-lg text-on-surface">{t('screens.settings.title')}</h1>
      </div>

      <Stagger className="grid grid-cols-1 lg:grid-cols-12 gap-gutter">
        {/* Nivel de presupuesto — lista vertical seleccionable (más densa que 3
            tarjetas cuadradas: cada fila usa todo el ancho y nada queda hueco). */}
        <Stagger.Item className="lg:col-span-7 bg-surface-panel border border-border-subtle rounded-lg inner-glow p-lg flex flex-col">
          <div className="flex justify-between items-center mb-md border-b border-border-subtle pb-sm">
            <h2 className="font-mono-data text-mono-data text-on-surface-variant">{t('screens.settings.budgetLevel').toUpperCase()}</h2>
            <MS name="tune" className="text-text-muted text-[16px]" />
          </div>
          <p className="font-body-md text-body-md text-on-surface-variant mb-md">{t('screens.settings.budgetLevelDesc')}</p>
          <div className="flex flex-col gap-sm flex-1">
            {BUDGET_LEVEL_CARDS.map((lv) => {
              const active = budgetLevel === lv.value;
              return (
                <button
                  key={lv.value}
                  onClick={() => setBudgetLevel(lv.value)}
                  aria-pressed={active}
                  className={`flex items-center gap-md p-md rounded border text-left transition-colors flex-1 ${active ? 'border-primary bg-primary/10' : 'border-border-subtle hover:bg-surface-container-high'}`}
                >
                  <span className={`w-9 h-9 rounded flex items-center justify-center shrink-0 ${active ? 'text-primary bg-primary/15' : 'text-text-muted bg-surface-container-high'}`}>
                    <MS name={lv.icon} className="!text-[18px]" />
                  </span>
                  <span className="flex flex-col gap-xs min-w-0">
                    <span className="font-label-sm text-label-sm text-on-surface">{lv.title}</span>
                    <span className="font-mono-data text-mono-data text-text-muted leading-relaxed normal-case tracking-normal">{lv.desc}</span>
                  </span>
                  <span className="ml-auto shrink-0">
                    {active
                      ? <MS name="check_circle" className="!text-[20px] text-primary" />
                      : <span className="block w-[18px] h-[18px] rounded-full border border-border-subtle" />}
                  </span>
                </button>
              );
            })}
          </div>
        </Stagger.Item>

        {/* Moneda — el select + una vista previa real del formato. La vista previa
            llena la tarjeta con información útil (cómo se verán los montos) en
            lugar de dejar aire muerto junto a la columna de niveles. */}
        <Stagger.Item className="lg:col-span-5 bg-surface-panel border border-border-subtle rounded-lg inner-glow p-lg flex flex-col">
          <div className="flex justify-between items-center mb-md border-b border-border-subtle pb-sm">
            <h2 className="font-mono-data text-mono-data text-on-surface-variant">{t('screens.settings.currencyLabel').toUpperCase()}</h2>
            <MS name="currency_exchange" className="text-text-muted text-[16px]" />
          </div>
          <StitchSelect
            value={currency || ''}
            onChange={setCurrency}
            options={currencyOpts}
            placeholder={t('screens.settings.currencyLabel')}
          />
          <div className="flex-1 flex flex-col justify-center items-center text-center gap-xs my-md rounded border border-border-subtle bg-surface-card p-md min-h-[120px]">
            <span className="font-mono-data text-mono-data text-text-muted uppercase">{t('screens.settings.currencyPreview')}</span>
            <span className="font-headline-md text-[30px] text-on-background tracking-tighter">{formatCurrency(1250)}</span>
            <div className="flex items-center gap-md font-mono-data text-[11px]">
              <span className="text-tertiary">+{formatCurrency(45800)}</span>
              <span className="text-accent-error">−{formatCurrency(12350)}</span>
            </div>
          </div>
          <p className="font-mono-data text-mono-data text-text-muted normal-case tracking-normal">
            {t('screens.settings.currencyWarning')}
          </p>
        </Stagger.Item>

        {/* Datos — tiles de acción a lo ancho (PDF / CSV-Excel / Export). */}
        <Stagger.Item className="lg:col-span-12 bg-surface-panel border border-border-subtle rounded-lg inner-glow p-lg">
          <div className="flex justify-between items-center mb-md border-b border-border-subtle pb-sm">
            <h2 className="font-mono-data text-mono-data text-on-surface-variant">{t('screens.settings.data').toUpperCase()} · {transactions.length} {t('screens.settings.transactionsUpper').toUpperCase()}</h2>
            <MS name="database" className="text-text-muted text-[16px]" />
          </div>
          <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" onChange={onFile} className="hidden" />
          <input ref={pdfRef} type="file" accept="application/pdf" onChange={onPdfFile} className="hidden" />
          {demo && (
            <div className="flex items-center gap-sm mb-md px-md py-sm rounded bg-secondary/10 border border-secondary/30">
              <MS name="info" className="!text-[16px] text-secondary shrink-0" />
              <span className="font-mono-data text-mono-data text-secondary normal-case tracking-normal">{t('screens.settings.demoImportNote')}</span>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-md">
            <Tile icon="picture_as_pdf" l={t('screens.settings.importPdf')} d={demo ? t('screens.settings.notAvailableDemo') : (parsingPdf ? t('screens.settings.processing') : t('screens.settings.banksSupported'))} onClick={() => pdfRef.current?.click()} disabled={demo || parsingPdf} />
            <Tile icon="upload_file" l={t('screens.settings.importCsv')} d={demo ? t('screens.settings.notAvailableDemo') : t('screens.settings.bulkLoad')} onClick={() => fileRef.current?.click()} disabled={demo} />
            <Tile icon="grid_on" l={t('screens.settings.exportExcel')} d={t('screens.settings.xlsxFormat')} onClick={doExport} />
          </div>
        </Stagger.Item>

        {/* Efectivo inicial: base del efectivo líquido del Dashboard. En demo se
            guarda en memoria; con sesión se persiste en profiles. */}
        <Stagger.Item className="lg:col-span-6 bg-surface-panel border border-border-subtle rounded-lg inner-glow p-lg flex flex-col gap-sm">
          <h2 className="font-mono-data text-mono-data text-on-surface-variant border-b border-border-subtle pb-sm">{t('screens.settings.initialCashLabel').toUpperCase()}</h2>
          <div className="max-w-[280px]">
            <StitchCurrencyInput
              value={initialCashBalance === 0 ? '' : String(initialCashBalance)}
              onChange={(v) => { if (demo) demoSetInitialCashBalance(v); else setInitialCashBalance(v); }}
            />
          </div>
          <span className="font-label-sm text-label-sm text-text-muted">{t('screens.settings.initialCashHelp')}</span>
        </Stagger.Item>

        {/* Recordatorios de pago: el cron diario (api/cron/card-reminders) lee
            estas preferencias de `profiles`. El aviso del día del vencimiento y
            los de mora van siempre; aquí solo se elige la antelación. */}
        <Stagger.Item className="lg:col-span-6 bg-surface-panel border border-border-subtle rounded-lg inner-glow p-lg flex flex-col gap-sm">
          <div className="flex justify-between items-center border-b border-border-subtle pb-sm">
            <h2 className="font-mono-data text-mono-data text-on-surface-variant">{t('screens.settings.remindersLabel').toUpperCase()}</h2>
            <MS name="notifications_active" className="text-text-muted text-[16px]" />
          </div>
          <button
            onClick={() => { const v = !remindersEnabled; if (demo) demoSetRemindersEnabled(v); else setRemindersEnabled(v); }}
            aria-pressed={remindersEnabled}
            className={`flex items-center gap-md p-md rounded border text-left transition-colors ${remindersEnabled ? 'border-primary bg-primary/10' : 'border-border-subtle hover:bg-surface-container-high'}`}
          >
            <span className={`w-9 h-9 rounded flex items-center justify-center shrink-0 ${remindersEnabled ? 'text-primary bg-primary/15' : 'text-text-muted bg-surface-container-high'}`}>
              <MS name={remindersEnabled ? 'notifications_active' : 'notifications_off'} className="!text-[18px]" />
            </span>
            <span className="font-label-sm text-label-sm text-on-surface">
              {remindersEnabled ? t('screens.settings.remindersOn') : t('screens.settings.remindersOff')}
            </span>
            <span className="ml-auto shrink-0">
              {remindersEnabled
                ? <MS name="check_circle" className="!text-[20px] text-primary" />
                : <span className="block w-[18px] h-[18px] rounded-full border border-border-subtle" />}
            </span>
          </button>
          <div className="flex flex-wrap gap-sm">
            {REMINDER_PRESETS.map((preset) => {
              const active = reminderDaysBefore.join(',') === preset.days.join(',');
              return (
                <button
                  key={preset.key}
                  disabled={!remindersEnabled}
                  onClick={() => { if (demo) demoSetReminderDaysBefore(preset.days); else setReminderDaysBefore(preset.days); }}
                  aria-pressed={active}
                  className={`px-md py-sm rounded border font-label-sm text-label-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${active && remindersEnabled ? 'border-primary bg-primary/10 text-primary' : 'border-border-subtle text-on-surface-variant hover:bg-surface-container-high'}`}
                >
                  {t(`screens.settings.${preset.key}`)}
                </button>
              );
            })}
          </div>
          <span className="font-label-sm text-label-sm text-text-muted">{t('screens.settings.remindersHelp')}</span>
        </Stagger.Item>

      </Stagger>

      {pdfData && (
        <StatementImportModal onClose={() => setPdfData(null)} pdfData={pdfData} />
      )}
    </div>
  );
}

// Tile de acción de datos: icono + título + descripción, mismo alto en la fila.
function Tile({ icon, l, d, onClick, disabled = false }) {
  return (
    <button onClick={onClick} disabled={disabled} className={`group flex items-center gap-md p-md rounded border border-border-subtle bg-surface-card transition-colors text-left ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-surface-container-high hover:border-primary/40'}`}>
      <span className="w-9 h-9 rounded flex items-center justify-center shrink-0 bg-surface-container-high text-primary">
        <MS name={icon} className="!text-[18px]" />
      </span>
      <span className="flex flex-col gap-xs min-w-0">
        <span className="font-label-sm text-label-sm text-on-surface">{l}</span>
        <span className="font-mono-data text-mono-data text-text-muted normal-case tracking-normal">{d}</span>
      </span>
      <MS name="arrow_outward" className={`!text-[16px] text-text-muted ml-auto shrink-0 transition-colors ${disabled ? '' : 'group-hover:text-primary'}`} />
    </button>
  );
}
