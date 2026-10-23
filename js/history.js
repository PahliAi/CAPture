// Per-day totals for the History overview. Deleted items are not counted; private items are.

// Counts per type, the time from the first start to the last end, the time spent recording speech, and its share.
export function summarizeDay(day) {
    const items = day.events.filter(e => !e.deleted);
    const count = type => items.filter(e => e.type === type).length;
    let first = Infinity;
    let last = -Infinity;
    for (const e of items) {
        first = Math.min(first, e.start.getTime());
        last = Math.max(last, e.end.getTime());
    }
    const spanMs = items.length ? Math.max(0, last - first) : 0;
    const audioMs = items.filter(e => e.type === 'speech').reduce((sum, e) => sum + Math.max(0, e.end - e.start), 0);
    return {
        key: day.key,
        items: items.length,
        speech: count('speech'),
        screenshot: count('screenshot'),
        file: count('file'),
        note: count('note'),
        spanMs,
        audioMs,
        share: spanMs > 0 ? Math.min(1, audioMs / spanMs) : null
    };
}

// "1 h 05 min" for an hour or more, "12 min 05 s" under an hour, "45 s" under a minute.
export function formatDuration(ms) {
    const total = Math.round(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h) return `${h} h ${String(m).padStart(2, '0')} min`;
    if (m) return `${m} min ${String(s).padStart(2, '0')} s`;
    return `${s} s`;
}

export function formatShare(share) {
    return share === null ? '-' : `${Math.round(share * 100)}%`;
}
