// Runtime i18n para código fuera de React (formatters, selectors, analysis…).
// I18nProvider sincroniza el idioma aquí; como los selectors/formatters corren
// durante el render, siempre leen el idioma vigente.

import translations from './translations.js';

let currentLanguage = 'es';

export function setRuntimeLanguage(lang) {
  if (lang === 'es' || lang === 'en') currentLanguage = lang;
}

export function getRuntimeLanguage() {
  return currentLanguage;
}

// Locale BCP-47 para Intl (fechas/números) según idioma activo.
export function currentLocale() {
  return currentLanguage === 'es' ? 'es-DO' : 'en-US';
}

// Nombres de meses/días según idioma activo (UI usa estos, no las constantes ES).
const MONTHS = {
  es: ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};
const MONTHS_SHORT = {
  es: ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};
const DAYS_SHORT = {
  es: ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
};

export function monthName(i) {
  return MONTHS[currentLanguage][i] || '';
}

export function monthShort(i) {
  return MONTHS_SHORT[currentLanguage][i] || '';
}

export function dayShort(i) {
  return DAYS_SHORT[currentLanguage][i] || '';
}

// Traducción fuera de componentes; misma semántica que t() del contexto.
export function tr(key, defaultValue = key) {
  const keys = key.split('.');
  let value = translations[currentLanguage];
  for (const k of keys) {
    if (value && typeof value === 'object' && k in value) {
      value = value[k];
    } else {
      return defaultValue;
    }
  }
  return value || defaultValue;
}
