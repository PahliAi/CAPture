import { en } from './i18n-en.js';
import { nl } from './i18n-nl.js';

export const messages = { en, nl };
let lang = 'en';

export function setLang(next) {
    if (messages[next]) lang = next;
}

export function getLang() {
    return lang;
}

export function t(key, vars = {}) {
    const text = (messages[lang] && messages[lang][key]) ?? messages.en[key] ?? key;
    return text.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m));
}

// Translate every element that carries a data-i18n* attribute.
export function applyI18n(root = document) {
    document.documentElement.lang = lang;
    root.querySelectorAll('[data-i18n]').forEach(n => { n.textContent = t(n.dataset.i18n); });
    root.querySelectorAll('[data-i18n-placeholder]').forEach(n => { n.placeholder = t(n.dataset.i18nPlaceholder); });
    root.querySelectorAll('[data-i18n-aria]').forEach(n => { n.setAttribute('aria-label', t(n.dataset.i18nAria)); });
    root.querySelectorAll('[data-i18n-title]').forEach(n => { n.title = t(n.dataset.i18nTitle); });
}
