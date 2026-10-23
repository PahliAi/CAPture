// Continuous speech recognition on top of the browser's SpeechRecognition, with restarts and failure handling.
//
// The browser ends a recognition session by itself every so often (after silence, or after a while). While the user
// wants to keep listening, a new session is started. If sessions keep ending at once, listening is stopped.

export function createBrowserRecognition(win = globalThis) {
    const Ctor = win.SpeechRecognition || win.webkitSpeechRecognition;
    return Ctor ? () => new Ctor() : null;
}

export class SpeechSession {
    constructor({
        createRecognition, lang,
        onFinal = () => {}, onInterim = () => {}, onError = () => {}, onState = () => {},
        maxFailures = 4, restartDelayMs = 50, quickEndMs = 1500, drainMs = 1500,
        now = () => Date.now(), setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = id => clearTimeout(id)
    }) {
        Object.assign(this, { createRecognition, lang, onFinal, onInterim, onError, onState, maxFailures, restartDelayMs, quickEndMs, drainMs, now, setTimer, clearTimer });
        this.wanted = false;
        this.recognition = null;
        this.failures = 0;
        this.startedAt = 0;
        this.timer = null;
        this.draining = null;
    }

    get running() {
        return this.wanted;
    }

    start() {
        if (this.wanted) return;
        this.wanted = true;
        this.failures = 0;
        this.onState('listening');
        this.#spawn();
    }

    // Stops listening. By default the recognizer may still deliver words spoken just before the stop; the returned
    // promise resolves when it has finished. With discard, anything still in flight is dropped at once.
    stop({ discard = false } = {}) {
        if (!this.wanted && !this.recognition) return Promise.resolve();
        this.wanted = false;
        this.clearTimer(this.timer);
        this.timer = null;
        const rec = this.recognition;
        this.recognition = null;
        this.onInterim('');
        this.onState('stopped');
        if (!rec) return Promise.resolve();

        if (discard) {
            SpeechSession.#detach(rec);
            try { rec.abort ? rec.abort() : rec.stop(); } catch { /* already stopped */ }
            return Promise.resolve();
        }
        return new Promise(resolve => {
            let timer = null;
            const done = () => {
                this.clearTimer(timer);
                SpeechSession.#detach(rec);
                this.draining = null;
                resolve();
            };
            this.draining = rec;
            rec.onend = done;
            timer = this.setTimer(done, this.drainMs);
            try { rec.stop(); } catch { done(); }
        });
    }

    static #detach(rec) {
        rec.onresult = null;
        rec.onerror = null;
        rec.onend = null;
    }

    setLang(lang) {
        this.lang = lang;
        if (!this.wanted) return;
        const rec = this.recognition;
        this.recognition = null;
        if (rec) {
            SpeechSession.#detach(rec);
            try { rec.abort ? rec.abort() : rec.stop(); } catch { /* already stopped */ }
        }
        this.#spawn();
    }

    #fatal(kind) {
        this.stop({ discard: true });
        this.onError(kind);
    }

    #spawn() {
        if (!this.wanted) return;
        const rec = this.createRecognition();
        this.recognition = rec;
        rec.lang = this.lang;
        rec.continuous = true;
        rec.interimResults = true;
        rec.maxAlternatives = 1;
        this.startedAt = this.now();

        rec.onresult = ev => {
            if (this.recognition !== rec && this.draining !== rec) return;
            let interim = '';
            for (let i = ev.resultIndex; i < ev.results.length; i++) {
                const r = ev.results[i];
                const text = r[0].transcript;
                if (r.isFinal) {
                    this.failures = 0;
                    const clean = text.trim();
                    if (clean) this.onFinal(clean);
                } else {
                    interim += text;
                }
            }
            this.onInterim(interim.trim());
        };

        rec.onerror = ev => {
            if (this.recognition !== rec) return;
            switch (ev.error) {
                case 'no-speech':
                case 'aborted':
                    return;
                case 'not-allowed':
                case 'service-not-allowed':
                    this.#fatal('denied');
                    return;
                case 'audio-capture':
                    this.#fatal('missing');
                    return;
                case 'network':
                    this.network = true;
                    this.failures++;
                    return;
                default:
                    this.failures++;
            }
        };

        rec.onend = () => {
            if (this.recognition !== rec || !this.wanted) return;
            this.recognition = null;
            if (this.now() - this.startedAt < this.quickEndMs) this.failures++;
            if (this.failures >= this.maxFailures) {
                const kind = this.network ? 'network' : 'failing';
                this.network = false;
                this.#fatal(kind);
                return;
            }
            this.timer = this.setTimer(() => { this.timer = null; this.#spawn(); }, this.restartDelayMs);
        };

        try {
            rec.start();
        } catch {
            this.recognition = null;
            this.failures++;
            if (this.failures >= this.maxFailures) {
                this.#fatal('failing');
            } else {
                this.timer = this.setTimer(() => { this.timer = null; this.#spawn(); }, this.restartDelayMs);
            }
        }
    }
}
