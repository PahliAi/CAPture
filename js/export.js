// Builds the export ZIP (format "capture-export", version 1; see docs/export-format.md).
// Only items that are neither private nor deleted are exported. The ZIP mirrors the day folders on disk.
import { makeZip } from './zip.js';

export const FORMAT = 'capture-export';
export const VERSION = 1;
export const WARN_BYTES = 200 * 1024 * 1024;
export const BLOCK_BYTES = 1024 * 1024 * 1024;

const pad = n => String(n).padStart(2, '0');
const hm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function includedEvents(day) {
    return day.events.filter(e => !e.private && !e.deleted).sort((a, b) => a.start - b.start);
}

export function countsOf(events) {
    const count = t => events.filter(e => e.type === t).length;
    return { speech: count('speech'), screenshot: count('screenshot'), file: count('file'), note: count('note') };
}

// Rough size of the ZIP: attached files plus a small allowance per item for the text records.
export function estimateBytes(days) {
    return days.reduce((sum, day) => sum + includedEvents(day).reduce((s, e) => s + (e.file ? e.size : 0) + 1024, 0), 0);
}

export function exportName(days) {
    const keys = days.map(d => d.key).sort();
    return keys.length === 1 ? `capture-${keys[0]}.zip` : `capture-${keys[0]}_to_${keys[keys.length - 1]}.zip`;
}

export async function buildExport(days, now = new Date()) {
    const enc = new TextEncoder();
    const files = [];
    const manifestDays = [];

    for (const day of [...days].sort((a, b) => a.key.localeCompare(b.key))) {
        const inc = includedEvents(day);
        const lines = [];
        const transcript = ['# Transcript', ''];

        for (const e of inc) {
            const line = { id: e.id, type: e.type, start: e.start.toISOString(), end: e.end.toISOString() };
            if (e.text) line.text = e.text;
            if (e.type === 'speech') transcript.push(`## ${hm(e.start)} - ${hm(e.end)}`, '', e.text, '');
            if (e.file) {
                const blob = await day.readBlob(e);
                line.file = e.file;
                line.name = e.name;
                line.size = blob.size;
                line.mime = e.mime;
                files.push({ name: `${day.key}/${e.file}`, data: new Uint8Array(await blob.arrayBuffer()) });
            }
            lines.push(JSON.stringify(line));
        }

        files.unshift(
            { name: `${day.key}/events.jsonl`, data: enc.encode(lines.length ? lines.join('\n') + '\n' : '') },
            { name: `${day.key}/transcript.md`, data: enc.encode(transcript.join('\n')) }
        );
        manifestDays.push({ date: day.key, counts: countsOf(inc) });
    }

    const manifest = { format: FORMAT, version: VERSION, createdAt: now.toISOString(), days: manifestDays };
    files.unshift({ name: 'manifest.json', data: enc.encode(JSON.stringify(manifest, null, 2)) });
    return { files, manifest };
}

export function zipBlob(files, when) {
    return new Blob(makeZip(files, when), { type: 'application/zip' });
}
