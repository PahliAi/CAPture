// Persistent storage for captured days. Works on any FileSystemDirectoryHandle.
//
// Layout inside the chosen folder:
//   YYYY-MM-DD/events.jsonl      one JSON record per line, rewritten atomically on every change
//   YYYY-MM-DD/screenshots/...   image files
//   YYYY-MM-DD/files/...         added files

export const MAX_FILE_BYTES = 250 * 1024 * 1024;

const TYPES = new Set(['speech', 'screenshot', 'file', 'note']);
const IMAGE_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const FILE_PATH_RE = /^(screenshots|files)\/[\p{L}\p{N}._ -]{1,200}$/u;

const pad = n => String(n).padStart(2, '0');

export function dayKey(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function isDayKey(s) {
    return typeof s === 'string' && DAY_RE.test(s);
}

// Reduce a user-supplied file name to characters that are safe in a path on every platform.
export function safeName(name) {
    const cleaned = String(name)
        .replace(/[^\p{L}\p{N}._ -]+/gu, '_')
        .replace(/\.{2,}/g, '.')
        .replace(/^[. ]+/, '_')
        .replace(/[. ]+$/, '')
        .slice(0, 120);
    return /[\p{L}\p{N}]/u.test(cleaned) ? cleaned : 'file';
}

function timeStamp(d) {
    return `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

// ---- records -------------------------------------------------------------

function toRecord(e) {
    const r = { id: e.id, type: e.type, start: e.start.toISOString(), end: e.end.toISOString() };
    if (e.text) r.text = e.text;
    if (e.file) r.file = e.file;
    if (e.name) r.name = e.name;
    if (e.size) r.size = e.size;
    if (e.mime) r.mime = e.mime;
    if (e.private) r.private = true;
    if (e.deleted) r.deleted = true;
    return r;
}

function fromRecord(r) {
    if (!r || typeof r !== 'object') throw new Error('not an object');
    if (!Number.isInteger(r.id) || r.id < 1) throw new Error('bad id');
    if (!TYPES.has(r.type)) throw new Error('bad type');
    const start = new Date(r.start);
    const end = new Date(r.end);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new Error('bad time');
    const file = r.file === undefined ? '' : r.file;
    if (file !== '' && !FILE_PATH_RE.test(file)) throw new Error('bad file path');
    return {
        id: r.id, type: r.type, start, end,
        text: typeof r.text === 'string' ? r.text : '',
        file,
        name: typeof r.name === 'string' ? r.name : '',
        size: Number.isFinite(r.size) ? r.size : 0,
        mime: typeof r.mime === 'string' ? r.mime : '',
        private: r.private === true,
        deleted: r.deleted === true
    };
}

// ---- file helpers --------------------------------------------------------

async function writeFile(dir, name, data) {
    const handle = await dir.getFileHandle(name, { create: true });
    const w = await handle.createWritable();
    try {
        await w.write(data);
    } finally {
        await w.close();
    }
}

async function resolveFile(dir, path) {
    const [folder, name] = path.split('/');
    const sub = await dir.getDirectoryHandle(folder);
    return sub.getFileHandle(name);
}

async function removeQuietly(dir, path) {
    try {
        const [folder, name] = path.split('/');
        const sub = await dir.getDirectoryHandle(folder);
        await sub.removeEntry(name);
    } catch {
        // already gone
    }
}

// ---- a single day --------------------------------------------------------

export class Day {
    constructor(parent, dir, key, events, damaged) {
        this.parent = parent;
        this.dir = dir;
        this.key = key;
        this.events = events;
        this.damaged = damaged;
        this.queue = Promise.resolve();
    }

    static async load(parent, dir, key) {
        let text = '';
        try {
            const handle = await dir.getFileHandle('events.jsonl');
            text = await (await handle.getFile()).text();
        } catch (err) {
            if (err.name !== 'NotFoundError') throw err;
        }
        const events = [];
        let damaged = 0;
        for (const line of text.split('\n')) {
            if (!line.trim()) continue;
            try {
                events.push(fromRecord(JSON.parse(line)));
            } catch {
                damaged++;
            }
        }
        return new Day(parent, dir, key, events, damaged);
    }

    // A day with unreadable lines is never rewritten, so nothing is lost by accident.
    get readOnly() {
        return this.damaged > 0;
    }

    #assertWritable() {
        if (this.readOnly) throw new Error('This day has unreadable data and is kept read-only');
    }

    #enqueue(fn) {
        const run = this.queue.then(fn);
        this.queue = run.catch(() => {});
        return run;
    }

    async #persist() {
        const lines = this.events.map(e => JSON.stringify(toRecord(e)));
        await writeFile(this.dir, 'events.jsonl', lines.length ? lines.join('\n') + '\n' : '');
    }

    // input: { type, start?, end?, text?, name?, mime? }. blob: optional content for screenshots and files.
    async add(input, blob) {
        this.#assertWritable();
        if (!input || !TYPES.has(input.type)) throw new Error('Unknown item type');
        if (blob && blob.size > MAX_FILE_BYTES) {
            throw new Error(`File is larger than ${MAX_FILE_BYTES / 1048576} MB`);
        }
        return this.#enqueue(async () => {
            const id = this.events.reduce((m, e) => Math.max(m, e.id), 0) + 1;
            const start = input.start || new Date();
            const end = input.end || start;
            const e = {
                id, type: input.type, start, end, text: input.text || '',
                file: '', name: '', size: 0, mime: '', private: false, deleted: false
            };
            if (blob) {
                if (input.type === 'screenshot') {
                    e.mime = blob.type || 'image/png';
                    e.file = `screenshots/${timeStamp(start)}-${id}.${IMAGE_EXT[e.mime] || 'png'}`;
                    e.name = e.file.split('/')[1];
                } else {
                    e.mime = blob.type || input.mime || 'application/octet-stream';
                    e.name = String(input.name || 'file').slice(0, 255);
                    e.file = `files/${id}-${safeName(input.name || 'file')}`;
                }
                e.size = blob.size;
                const sub = await this.dir.getDirectoryHandle(e.file.split('/')[0], { create: true });
                await writeFile(sub, e.file.split('/')[1], blob);
            }
            this.events.push(e);
            try {
                await this.#persist();
            } catch (err) {
                this.events.pop();
                if (e.file) await removeQuietly(this.dir, e.file);
                throw err;
            }
            return e;
        });
    }

    // Persist the current in-memory state (call after editing text, private or deleted).
    async save() {
        this.#assertWritable();
        return this.#enqueue(() => this.#persist());
    }

    async readBlob(e) {
        if (!e.file) return null;
        const handle = await resolveFile(this.dir, e.file);
        return handle.getFile();
    }

    // Remove deleted items, and their files, from disk for good.
    async purgeDeleted() {
        this.#assertWritable();
        return this.#enqueue(async () => {
            const gone = this.events.filter(e => e.deleted);
            this.events = this.events.filter(e => !e.deleted);
            await this.#persist();
            for (const e of gone) if (e.file) await removeQuietly(this.dir, e.file);
            return gone.length;
        });
    }

    // Permanently remove the given items (and their files), whatever their state.
    async remove(ids) {
        this.#assertWritable();
        return this.#enqueue(async () => {
            const wanted = new Set(ids);
            const gone = this.events.filter(e => wanted.has(e.id));
            if (!gone.length) return 0;
            this.events = this.events.filter(e => !wanted.has(e.id));
            await this.#persist();
            for (const e of gone) if (e.file) await removeQuietly(this.dir, e.file);
            return gone.length;
        });
    }

    // Split a speech or note item in two at a text position. The time is divided in proportion to the text.
    async split(id, index) {
        this.#assertWritable();
        return this.#enqueue(async () => {
            const e = this.events.find(x => x.id === id);
            if (!e || (e.type !== 'speech' && e.type !== 'note')) throw new Error('This item cannot be split');
            const first = e.text.slice(0, index).trimEnd();
            const second = e.text.slice(index).trimStart();
            if (!first || !second) throw new Error('Nothing to split here');
            const span = e.end - e.start;
            const mid = span > 0 ? new Date(e.start.getTime() + Math.round(span * (index / e.text.length))) : e.start;
            const created = {
                id: this.events.reduce((m, x) => Math.max(m, x.id), 0) + 1,
                type: e.type, start: mid, end: e.end, text: second,
                file: '', name: '', size: 0, mime: '', private: e.private, deleted: e.deleted
            };
            e.text = first;
            e.end = mid;
            this.events.push(created);
            await this.#persist();
            return created;
        });
    }

    // Save a generated file (for example an export) in this day's folder.
    async writeExport(name, blob) {
        return this.#enqueue(() => writeFile(this.dir, safeName(name), blob));
    }

    // Delete the whole day folder.
    async destroy() {
        return this.#enqueue(() => this.parent.removeEntry(this.key, { recursive: true }));
    }
}

// ---- the folder with all days -------------------------------------------

export class DayStore {
    constructor(root) {
        this.root = root;
    }

    async listDays() {
        const keys = [];
        for await (const [name, handle] of this.root.entries()) {
            if (handle.kind === 'directory' && isDayKey(name)) keys.push(name);
        }
        return keys.sort().reverse();
    }

    // Save a generated file (for example a multi-day export) next to the day folders.
    async writeExport(name, blob) {
        return writeFile(this.root, safeName(name), blob);
    }

    async openDay(key, create = true) {
        if (!isDayKey(key)) throw new Error('Invalid day');
        const dir = await this.root.getDirectoryHandle(key, { create });
        return Day.load(this.root, dir, key);
    }
}
