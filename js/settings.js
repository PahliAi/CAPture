// User settings, kept in the browser's local storage. Every value is validated on load.
export const SPEECH_LANGS = ['nl-NL', 'en-US'];
export const UI_LANGS = ['en', 'nl'];
export const IMAGE_FORMATS = ['jpeg', 'webp', 'png'];
export const CAPTURE_MODES = ['screen', 'window', 'tab', 'region', 'ask'];
export const HOTKEYS = ['', 'F8', 'F9', 'F10'];
export const MAX_MASKS = 20;

export const DEFAULTS = Object.freeze({
    speechLang: 'nl-NL',
    uiLang: 'en',
    imageFormat: 'jpeg',
    imageQuality: 0.85,
    hotkey: 'F10',
    captureMode: 'screen',
    region: null,
    masks: [],
    lastScreen: ''
});

const KEY = 'capture.settings';
const num = (v, min, max, fallback) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback);

function cleanMask(m) {
    if (!m || typeof m !== 'object') return null;
    const x = num(m.x, 0, 1, NaN);
    const y = num(m.y, 0, 1, NaN);
    const w = num(m.w, 0, 1, NaN);
    const h = num(m.h, 0, 1, NaN);
    if ([x, y, w, h].some(Number.isNaN) || w < 0.005 || h < 0.005) return null;
    const round = v => Math.round(v * 1e6) / 1e6;
    return { x: round(x), y: round(y), w: round(Math.min(w, 1 - x)), h: round(Math.min(h, 1 - y)) };
}

export function sanitize(input) {
    const s = input && typeof input === 'object' ? input : {};
    return {
        speechLang: SPEECH_LANGS.includes(s.speechLang) ? s.speechLang : DEFAULTS.speechLang,
        uiLang: UI_LANGS.includes(s.uiLang) ? s.uiLang : DEFAULTS.uiLang,
        imageFormat: IMAGE_FORMATS.includes(s.imageFormat) ? s.imageFormat : DEFAULTS.imageFormat,
        imageQuality: num(s.imageQuality, 0.4, 1, DEFAULTS.imageQuality),
        hotkey: HOTKEYS.includes(s.hotkey) ? s.hotkey : DEFAULTS.hotkey,
        captureMode: CAPTURE_MODES.includes(s.captureMode) ? s.captureMode : DEFAULTS.captureMode,
        region: cleanMask(s.region),
        masks: (Array.isArray(s.masks) ? s.masks : []).map(cleanMask).filter(Boolean).slice(0, MAX_MASKS),
        lastScreen: typeof s.lastScreen === 'string' ? s.lastScreen.slice(0, 120) : ''
    };
}

export function loadSettings(storage = globalThis.localStorage) {
    try {
        return sanitize(JSON.parse(storage.getItem(KEY)));
    } catch {
        return sanitize(null);
    }
}

export function saveSettings(settings, storage = globalThis.localStorage) {
    const clean = sanitize(settings);
    try {
        storage.setItem(KEY, JSON.stringify(clean));
    } catch {
        // storage unavailable or full: settings simply do not persist
    }
    return clean;
}
