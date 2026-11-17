// Ajustes · Registro automático de gastos.
//
// Gestiona los tokens personales con los que un Atajo de iOS (Apple Pay o
// correos del banco) registra consumos vía /api/ingest. El token en claro solo
// existe en este componente, en memoria, hasta que el usuario lo copia: en la
// base vive su hash. Guía de configuración: docs/AUTO_INGEST.md.
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import MS from '../../MS';
import { Stagger } from '../../StitchMotion';
import { isDemoActive } from '../../demoMode';
import { useI18n } from '../../../contexts/I18nContext';
import { inputCls } from '../../formUi';
import { formatDate } from '../../../utils/formatters';
import {
  listIngestTokens, createIngestToken, revokeIngestToken, MAX_INGEST_TOKENS,
} from '../../../lib/ingestTokens';

const GUIDE_URL = 'https://github.com/Gian-DS1/fintrack/blob/main/docs/AUTO_INGEST.md';

export default function AutoIngestCard() {
  const { t } = useI18n();
  const demo = isDemoActive();
  const [tokens, setTokens] = useState([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState(null); // token recién creado, en claro

  const endpoint = `${window.location.origin}/api/ingest`;

  useEffect(() => {
    if (demo) return undefined;
    let cancelled = false;
    // Fallo silencioso al cargar: si falta la migración la lista queda vacía y
    // el error se muestra recién cuando el usuario intenta generar un token.
    listIngestTokens().then((rows) => { if (!cancelled) setTokens(rows); }).catch(() => {});
    return () => { cancelled = true; };
  }, [demo]);

  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t('screens.settings.autoIngestCopied'));
    } catch {
      toast.error(t('screens.settings.autoIngestError'));
    }
  };

  const create = async (e) => {
    e.preventDefault();
    if (tokens.length >= MAX_INGEST_TOKENS) { toast.error(t('screens.settings.autoIngestLimit')); return; }
    setBusy(true);
    try {
      const { token, row } = await createIngestToken(name);
      setTokens((list) => [...list, row]);
      setFresh(token);
      setName('');
    } catch {
      toast.error(t('screens.settings.autoIngestError'));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (token) => {
    if (!window.confirm(t('screens.settings.autoIngestConfirmRevoke').replace('{name}', token.name))) return;
    try {
      await revokeIngestToken(token.id);
      setTokens((list) => list.filter((x) => x.id !== token.id));
      toast.success(t('screens.settings.autoIngestRevoked'));
    } catch {
      toast.error(t('screens.settings.autoIngestError'));
    }
  };

  return (
    <Stagger.Item className="lg:col-span-12 bg-surface-panel border border-border-subtle rounded-lg inner-glow p-lg flex flex-col gap-md">
      <div className="flex justify-between items-center border-b border-border-subtle pb-sm">
        <h2 className="font-mono-data text-mono-data text-on-surface-variant">{t('screens.settings.autoIngestLabel').toUpperCase()}</h2>
        <MS name="bolt" className="text-text-muted text-[16px]" />
      </div>

      <p className="font-body-md text-body-md text-on-surface-variant">{t('screens.settings.autoIngestHelp')}</p>
      <a href={GUIDE_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-xs font-label-sm text-label-sm text-primary hover:underline self-start">
        <MS name="menu_book" className="!text-[16px]" /> {t('screens.settings.autoIngestGuide')}
      </a>

      {demo ? (
        <span className="font-mono-data text-mono-data text-text-muted normal-case tracking-normal">{t('screens.settings.notAvailableDemo')}</span>
      ) : (
        <>
          {/* Token recién generado: única vez que se ve completo. */}
          {fresh && (
            <div className="flex flex-col gap-sm p-md rounded border border-primary bg-primary/10">
              <span className="font-label-sm text-label-sm text-on-surface flex items-center gap-xs">
                <MS name="key" className="!text-[16px] text-primary" /> {t('screens.settings.autoIngestCreated')} · {t('screens.settings.autoIngestCopyWarning')}
              </span>
              <CopyRow value={fresh} onCopy={copy} label={t('screens.settings.autoIngestCopy')} />
              <span className="font-mono-data text-mono-data text-text-muted uppercase">{t('screens.settings.autoIngestEndpoint')}</span>
              <CopyRow value={endpoint} onCopy={copy} label={t('screens.settings.autoIngestCopy')} />
              <button type="button" onClick={() => setFresh(null)} className="self-start px-md py-sm rounded border border-border-subtle font-label-sm text-label-sm text-on-surface-variant hover:bg-surface-container-high transition-colors">
                {t('screens.settings.autoIngestDone')}
              </button>
            </div>
          )}

          {tokens.length === 0 ? (
            <span className="font-mono-data text-mono-data text-text-muted normal-case tracking-normal">{t('screens.settings.autoIngestEmpty')}</span>
          ) : (
            <ul className="flex flex-col gap-sm">
              {tokens.map((token) => (
                <li key={token.id} className="flex items-center gap-md p-md rounded border border-border-subtle bg-surface-card">
                  <span className="w-9 h-9 rounded flex items-center justify-center shrink-0 bg-surface-container-high text-primary">
                    <MS name="phone_iphone" className="!text-[18px]" />
                  </span>
                  <span className="flex flex-col gap-xs min-w-0">
                    <span className="font-label-sm text-label-sm text-on-surface break-words">{token.name} <span className="font-mono-data text-text-muted">ft_…{token.hint}</span></span>
                    <span className="font-mono-data text-mono-data text-text-muted normal-case tracking-normal">
                      {token.lastUsedAt
                        ? t('screens.settings.autoIngestLastUsed').replace('{date}', formatDate(token.lastUsedAt.slice(0, 10)))
                        : t('screens.settings.autoIngestNeverUsed')}
                    </span>
                  </span>
                  <button type="button" onClick={() => revoke(token)} className="ml-auto shrink-0 px-md py-sm rounded border border-border-subtle font-label-sm text-label-sm text-accent-error hover:bg-surface-container-high transition-colors">
                    {t('screens.settings.autoIngestRevoke')}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <form onSubmit={create} className="flex flex-col sm:flex-row gap-sm">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              placeholder={t('screens.settings.autoIngestNamePlaceholder')}
              aria-label={t('screens.settings.autoIngestNamePlaceholder')}
              className={`${inputCls} sm:max-w-[320px]`}
            />
            <button type="submit" disabled={busy} className="px-md py-sm rounded bg-primary text-on-primary font-label-sm text-label-sm transition-opacity disabled:opacity-50 inline-flex items-center justify-center gap-xs">
              <MS name="add" className="!text-[16px]" /> {t('screens.settings.autoIngestCreate')}
            </button>
          </form>
        </>
      )}
    </Stagger.Item>
  );
}

// Valor monoespaciado + botón de copiar. break-all: el token no tiene espacios
// y desbordaría la tarjeta en pantallas angostas.
function CopyRow({ value, onCopy, label }) {
  return (
    <div className="flex items-center gap-sm">
      <code className="flex-1 min-w-0 break-all font-mono-data text-mono-data normal-case tracking-normal text-on-surface bg-surface-container-lowest border border-border-subtle rounded px-md py-sm">{value}</code>
      <button type="button" onClick={() => onCopy(value)} className="shrink-0 px-md py-sm rounded border border-border-subtle font-label-sm text-label-sm text-on-surface hover:bg-surface-container-high transition-colors inline-flex items-center gap-xs">
        <MS name="content_copy" className="!text-[16px]" /> {label}
      </button>
    </div>
  );
}
