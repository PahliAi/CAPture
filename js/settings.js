// User settings, kept in the browser's local storage. Every value is validated on load.
export const SPEECH_LANGS = ['nl-NL', 'en-US'];
export const UI_LANGS = ['en', 'nl'];
export const IMAGE_FORMATS = ['jpeg', 'webp', 'png'];
export const CAPTURE_MODES = ['screen', 'window', 'tab', 'region', 'ask'];
export const MAX_MASKS = 20;
export const MAX_SCREENS = 8;

export const DEFAULTS = Object.freeze({
    speechLang: 'nl-NL',
    uiLang: 'en',
    imageFormat: 'jpeg',
    imageQuality: 0.85,
    captureMode: 'screen',
    region: null,
    masks: [],
    screenMasks: [],
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

function cleanMasks(list) {
    return (Array.isArray(list) ? list : []).map(cleanMask).filter(Boolean).slice(0, MAX_MASKS);
}

function cleanScreen(s) {
    if (!s || typeof s !== 'object' || typeof s.key !== 'string' || !s.key) return null;
    const width = Math.round(num(s.width, 1, 20000, NaN));
    const height = Math.round(num(s.height, 1, 20000, NaN));
    if (Number.isNaN(width) || Number.isNaN(height)) return null;
    return {
        key: s.key.slice(0, 200),
        label: typeof s.label === 'string' ? s.label.slice(0, 120) : '',
        width, height,
        masks: cleanMasks(s.masks)
    };
}

function cleanScreens(list) {
    const seen = new Set();
    const out = [];
    for (const s of (Array.isArray(list) ? list : []).map(cleanScreen)) {
        if (s && !seen.has(s.key)) { seen.add(s.key); out.push(s); }
    }
    return out.slice(0, MAX_SCREENS);
}

// Areas are kept per screen, matched on the browser's name for the screen and its size. Windows and tabs have no stable
// identity, so they (and any screen without a set of its own) use the general set in `masks`. Returns '' for those.
export function screenKey(source, size) {
    const surface = source && source.surface;
    if ((surface && surface !== 'monitor') || !size || !size.width || !size.height) return '';
    return `${(source && source.label) || ''}|${size.width}x${size.height}`;
}

export function masksFor(settings, key) {
    const own = key && settings.screenMasks.find(s => s.key === key);
    return own ? own.masks : settings.masks;
}

// Settings with `masks` stored for the screen described by `target` ({ key, label, width, height }), or as the general set
// when the target is not a screen. A screen keeps its set even when it is empty: that means "no areas on this screen".
export function withMasks(settings, target, masks) {
    if (!target || !target.key) return { ...settings, masks };
    const rest = settings.screenMasks.filter(s => s.key !== target.key);
    const entry = { key: target.key, label: target.label || '', width: target.width, height: target.height, masks };
    return { ...settings, screenMasks: [...rest, entry].slice(-MAX_SCREENS) };
}

export function totalMasks(settings) {
    return settings.masks.length + settings.screenMasks.reduce((n, s) => n + s.masks.length, 0);
}

export function sanitize(input) {
    const s = input && typeof input === 'object' ? input : {};
    return {
        speechLang: SPEECH_LANGS.includes(s.speechLang) ? s.speechLang : DEFAULTS.speechLang,
        uiLang: UI_LANGS.includes(s.uiLang) ? s.uiLang : DEFAULTS.uiLang,
        imageFormat: IMAGE_FORMATS.includes(s.imageFormat) ? s.imageFormat : DEFAULTS.imageFormat,
        imageQuality: num(s.imageQuality, 0.4, 1, DEFAULTS.imageQuality),
        captureMode: CAPTURE_MODES.includes(s.captureMode) ? s.captureMode : DEFAULTS.captureMode,
        region: cleanMask(s.region),
        masks: cleanMasks(s.masks),
        screenMasks: cleanScreens(s.screenMasks),
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
