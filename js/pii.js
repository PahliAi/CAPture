// Hints about text that may contain personal data. A hint, not a guarantee: it will miss things and flag harmless text.

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const IBAN_CANDIDATE = /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]){11,30}\b/g;
const PHONE = /(?:\+|\b00)\d[\d\s-]{8,14}\d|\b0\d[\d\s-]{7,11}\d\b/g;
const LONG_NUMBER = /\b\d{9,}\b/;

export function isValidIban(raw) {
    const s = raw.replace(/\s+/g, '').toUpperCase();
    if (s.length < 15 || s.length > 34 || !/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(s)) return false;
    const rearranged = s.slice(4) + s.slice(0, 4);
    let remainder = 0;
    for (const ch of rearranged) {
        const digits = ch >= 'A' && ch <= 'Z' ? String(ch.charCodeAt(0) - 55) : ch;
        for (const d of digits) remainder = (remainder * 10 + Number(d)) % 97;
    }
    return remainder === 1;
}

// Returns the kinds found, in a fixed order: 'email', 'iban', 'phone', 'number'.
export function detectPii(text) {
    if (!text) return [];
    const kinds = [];
    let rest = text;
    if (EMAIL.test(rest)) kinds.push('email');
    // Text that is a valid IBAN is not also reported as a phone or long number.
    let iban = false;
    for (const candidate of rest.match(IBAN_CANDIDATE) || []) {
        if (isValidIban(candidate)) { iban = true; rest = rest.replace(candidate, ' '); }
    }
    if (iban) kinds.push('iban');
    const phone = (rest.match(PHONE) || []).some(m => { const n = m.replace(/\D/g, '').length; return n >= 9 && n <= 15; });
    if (phone) kinds.push('phone');
    if (!phone && LONG_NUMBER.test(rest)) kinds.push('number');
    return kinds;
}
