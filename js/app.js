import { DayStore, dayKey } from './store.js';
import { loadRootHandle, saveRootHandle, pickFolder, permissionState, requestPermission } from './folder.js';
import { buildExport, includedEvents, estimateBytes, exportName, zipBlob, countsOf, WARN_BYTES, BLOCK_BYTES } from './export.js';
import { t, setLang, applyI18n } from './i18n.js';
import { loadSettings, saveSettings } from './settings.js';
import { ScreenCapture } from './capture.js';
import { SpeechSession, createBrowserRecognition } from './speech.js';
import { detectPii } from './pii.js';
import { createWidget } from './widget.js';
import { createViewer } from './viewer.js';
import { createMaskEditor } from './maskeditor.js';

window.__captureStarted = true;

// ---- State ---------------------------------------------------------------
const state = {
    store: null,
    day: null,
    todayKey: dayKey(new Date()),
    filter: 'all',
    search: '',
    selected: new Set(),
    recording: null,   // { day, event, session, start }
    interim: '',
    tick: null
};

let settings = loadSettings();
setLang(settings.uiLang);

const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, '0');
const hm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
}

function formatSize(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1048576).toFixed(1)} MB`;
}

let toastTimer = null;
function toast(msg, action) {
    $('toast-text').textContent = msg;
    const btn = $('toast-action');
    btn.hidden = !action;
    if (action) {
        btn.textContent = action.label;
        btn.onclick = async () => { $('toast').hidden = true; await action.run(); };
    }
    $('toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, action ? 8000 : 3500);
}

const undoAction = run => ({ label: t('toast.undo'), run });

// ---- Saving --------------------------------------------------------------
let saveTimer = null;

async function save(day = state.day) {
    try {
        await day.save();
    } catch (err) {
        toast(t('toast.saveFailed', { error: err.message }));
    }
}

function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveTimer = null; save(); }, 500);
}

async function flush() {
    if (!saveTimer) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    await save();
}

document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
window.addEventListener('pagehide', flush);

// ---- Widget, viewer, mask editor ------------------------------------------
const widget = createWidget({
    getState: () => ({
        mode: settings.captureMode,
        sharing: capture.active,
        label: capture.label,
        recording: !!state.recording,
        elapsed: state.recording ? Math.floor((Date.now() - state.recording.start) / 1000) : 0,
        lang: settings.speechLang
    }),
    camera: () => takeScreenshot(),
    switchNow: () => changeScreen(),
    stopSharing: () => { capture.stop(); updateShareUi(); },
    setMode: mode => setCaptureMode(mode, { draw: true }),
    drawRegion: () => startRegionDraw(),
    toggleMic: () => (state.recording ? finishRecording() : startRecording()),
    setLang: lang => changeSetting({ speechLang: lang }),
    addFiles: files => addFiles(files),
    onKey: ev => onHotkey(ev)
});

const viewer = createViewer({ getUrl: e => thumbUrl(e) });

const maskEditor = createMaskEditor({
    onSave: (kind, rects) => {
        settings = saveSettings(kind === 'region' ? { ...settings, region: rects[0] || null } : { ...settings, masks: rects });
        renderSettings();
    }
});

// ---- Screen capture ------------------------------------------------------
const capture = new ScreenCapture({
    onEnded: () => {
        updateShareUi();
        toast(t('toast.shareEnded'));
    }
});

function updateShareUi() {
    widget.render();
}

// The main window only has a screenshot button when the widget cannot start the screen picker by itself.
function revealShotButton() {
    $('shot').hidden = false;
}

// A short green flash on the button the user pressed, as a quiet confirmation that it worked.
function confirmed(button, widgetName) {
    button.classList.add('ok');
    setTimeout(() => button.classList.remove('ok'), 1000);
    widget.mark(widgetName, 'ok');
}

let sharingStart = null;

// Opens the screen picker. Calls made while a picker is already open join it instead of opening a second one.
function startSharing() {
    if (!sharingStart) {
        sharingStart = (async () => {
            const hadGesture = navigator.userActivation ? navigator.userActivation.isActive : true;
            try {
                await capture.start(settings.captureMode);
            } catch (err) {
                if (err.name === 'NotAllowedError' || err.name === 'AbortError') {
                    if (!hadGesture) revealShotButton();
                    toast(t(hadGesture ? 'toast.shareCancelled' : 'toast.shareNeedsClick'));
                } else {
                    toast(t('toast.captureFailed', { error: err.message }));
                }
                return false;
            }
            settings = saveSettings({ ...settings, lastScreen: capture.label });
            updateShareUi();
            return true;
        })().finally(() => { sharingStart = null; });
    }
    return sharingStart;
}

// Starts sharing if needed. Must run from a click so the browser allows the screen picker.
async function ensureSharing() {
    return capture.active ? true : startSharing();
}

async function changeScreen() {
    await startSharing();
}

async function takeScreenshot() {
    if (settings.captureMode === 'region' && !settings.region) {
        toast(t('toast.regionNeeded'));
        renderSettings();
        if (!$('settings-dialog').open) $('settings-dialog').showModal();
        return;
    }
    // Without a default the screen is chosen every time, so a previous choice is dropped first.
    if (settings.captureMode === 'ask' && capture.active) { capture.stop(); updateShareUi(); }
    if (!await ensureSharing()) { widget.mark('cam', 'fail'); return; }
    let blob;
    try {
        blob = await capture.grab({
            format: settings.imageFormat,
            quality: settings.imageQuality,
            masks: settings.masks,
            region: settings.captureMode === 'region' ? settings.region : null
        });
    } catch (err) {
        toast(t('toast.captureFailed', { error: err.message }));
        widget.mark('cam', 'fail');
        return;
    } finally {
        if (settings.captureMode === 'ask') { capture.stop(); updateShareUi(); }
    }
    const d = new Date();
    const added = await addToToday({ type: 'screenshot', start: d, end: d }, blob);
    if (added) {
        confirmed($('shot'), 'cam');
        toast(t('toast.screenshotSaved', { time: hm(d) }), undoAction(() => removeItems(added.day, [added.event.id])));
    }
}

function onHotkey(ev) {
    if (!settings.hotkey || ev.key !== settings.hotkey || ev.repeat) return;
    ev.preventDefault();
    takeScreenshot();
}
window.addEventListener('keydown', onHotkey);

// ---- Adding items --------------------------------------------------------
async function addToToday(input, blob) {
    try {
        const day = state.day.key === state.todayKey ? state.day : await state.store.openDay(state.todayKey);
        const event = await day.add(input, blob);
        if (day === state.day) render(); else toast(t('toast.addedToday'));
        await refreshDays();
        return { day, event };
    } catch (err) {
        toast(t('toast.saveFailed', { error: err.message }));
        return null;
    }
}

async function removeItems(day, ids) {
    try {
        await day.remove(ids);
        if (day === state.day) render();
    } catch (err) {
        toast(t('toast.saveFailed', { error: err.message }));
    }
}

async function addFiles(fileList) {
    const now = new Date();
    let added = 0;
    for (const f of fileList) {
        if (await addToToday({ type: 'file', name: f.name, start: now, end: now, mime: f.type }, f)) added++;
    }
    if (added < fileList.length) widget.mark('file', 'fail');
    if (added) {
        widget.mark('file', 'ok');
        toast(t('toast.files', { n: added }));
    }
}

async function addNote(text) {
    const value = text.trim();
    if (!value) return false;
    return !!await addToToday({ type: 'note', text: value });
}

// ---- Speech ---------------------------------------------------------------
async function startRecording() {
    if (state.recording) return;
    const createRecognition = createBrowserRecognition();
    if (!createRecognition) { toast(t('toast.speechUnsupported')); return; }

    const start = new Date();
    const added = await addToToday({ type: 'speech', start, end: start, text: '' });
    if (!added) return;
    const { day, event } = added;

    const session = new SpeechSession({
        createRecognition,
        lang: settings.speechLang,
        onFinal: text => {
            event.text = event.text ? `${event.text} ${text}` : text;
            event.end = new Date();
            save(day);
            if (day === state.day) render();
        },
        onInterim: text => { state.interim = text; widget.render(); },
        onError: kind => {
            const key = { denied: 'toast.micDenied', missing: 'toast.micMissing', network: 'toast.speechNetwork', failing: 'toast.speechStopped' }[kind];
            toast(t(key || 'toast.speechStopped'));
            widget.mark('mic', 'fail');
            finishRecording({ quiet: true, discard: true });
        }
    });
    state.recording = { day, event, session, start };
    state.interim = '';
    state.tick = setInterval(() => widget.render(), 1000);
    session.start();
    render();
    widget.render();
}

async function finishRecording({ quiet = false, discard = false } = {}) {
    const rec = state.recording;
    if (!rec || rec.finishing) return;
    rec.finishing = true;
    clearInterval(state.tick);
    // A normal stop waits for the words spoken just before it; an error drops anything still in flight.
    await rec.session.stop({ discard });
    state.recording = null;
    state.interim = '';
    try {
        if (!rec.event.text.trim()) {
            await rec.day.remove([rec.event.id]);
            if (!quiet) toast(t('toast.noSpeech'));
        } else {
            rec.event.end = new Date();
            await rec.day.save();
        }
    } catch (err) {
        toast(t('toast.saveFailed', { error: err.message }));
    }
    if (rec.day === state.day) render();
    widget.render();
}

// ---- Rendering: timeline -------------------------------------------------
function matchesFilter(e) {
    if (state.filter === 'included') return !e.private && !e.deleted;
    if (state.filter === 'excluded') return e.private || e.deleted;
    return state.filter === 'all' || e.type === state.filter;
}

function matchesSearch(e) {
    const q = state.search.trim().toLowerCase();
    return !q || `${e.text} ${e.name}`.toLowerCase().includes(q);
}

function visibleEvents() {
    return state.day.events.filter(e => matchesFilter(e) && matchesSearch(e)).sort((a, b) => a.start - b.start);
}

async function thumbUrl(e) {
    if (!e.url) e.url = URL.createObjectURL(await state.day.readBlob(e));
    return e.url;
}

function releaseUrls() {
    if (!state.day) return;
    for (const e of state.day.events) if (e.url) { URL.revokeObjectURL(e.url); e.url = null; }
}

// Apply a change to flags on some items, with an undo.
async function changeFlags(events, patch, messageKey) {
    if (!events.length || state.day.readOnly) return;
    const before = events.map(e => ({ e, private: e.private, deleted: e.deleted }));
    for (const e of events) Object.assign(e, patch(e));
    render();
    await flush();
    await save();
    toast(t(messageKey, { n: events.length }), undoAction(async () => {
        for (const b of before) { b.e.private = b.private; b.e.deleted = b.deleted; }
        render();
        await save();
    }));
}

async function splitItem(e, textarea) {
    const index = textarea.selectionStart;
    if (!index || index >= textarea.value.length) { toast(t('toast.splitNothing')); return; }
    await flush();
    try {
        await state.day.split(e.id, index);
        render();
        toast(t('toast.split'));
    } catch (err) {
        toast(t('toast.saveFailed', { error: err.message }));
    }
}

function renderEvent(e, screenshots) {
    const readOnly = state.day.readOnly;
    const live = !!state.recording && state.recording.event === e;
    const li = el('li', 'event' + (e.private ? ' private' : '') + (e.deleted ? ' deleted' : '') + (live ? ' live' : ''));
    li.dataset.id = String(e.id);

    const check = el('input');
    check.type = 'checkbox';
    check.className = 'pick';
    check.checked = state.selected.has(e.id);
    check.setAttribute('aria-label', t('row.select'));
    check.addEventListener('change', () => {
        if (check.checked) state.selected.add(e.id); else state.selected.delete(e.id);
        renderBulk();
    });

    const time = el('div', 'time', e.end - e.start > 1000 ? `${hm(e.start)} - ${hm(e.end)}` : hm(e.start));
    const badge = el('div', `badge ${e.type}`, t(`type.${e.type}`));

    const body = el('div', 'body');
    if (e.type === 'speech' || e.type === 'note') {
        const ta = el('textarea');
        ta.value = e.text;
        ta.disabled = e.deleted || readOnly;
        ta.setAttribute('aria-label', t('row.textLabel', { type: t(`type.${e.type}`) }));
        ta.addEventListener('input', () => { e.text = ta.value; saveSoon(); });
        body.appendChild(ta);
        const kinds = detectPii(e.text);
        if (kinds.length) body.appendChild(el('div', 'pii', t('row.pii', { kinds: kinds.map(k => t(`pii.${k}`)).join(', ') })));
        li.split = () => splitItem(e, ta);
    } else if (e.type === 'screenshot') {
        const thumb = el('button', 'thumb');
        thumb.type = 'button';
        thumb.title = t('row.view');
        const img = el('img');
        img.alt = t('row.screenshotAlt', { time: hm(e.start) });
        thumbUrl(e).then(u => { img.src = u; }).catch(() => { img.alt = t('row.imageMissing'); });
        thumb.appendChild(img);
        thumb.addEventListener('click', () => viewer.open(screenshots, screenshots.indexOf(e)));
        body.appendChild(thumb);
        body.appendChild(el('div', 'meta', `${e.name} - ${formatSize(e.size)}`));
    } else {
        body.appendChild(el('div', '', e.name));
        body.appendChild(el('div', 'meta', `${e.mime} - ${formatSize(e.size)}`));
    }
    if (e.private) body.appendChild(el('div', 'meta', t('row.privateNote')));

    const actions = el('div', 'actions');
    const priv = el('button', 'toggle', t('row.private'));
    priv.setAttribute('aria-pressed', String(e.private));
    priv.disabled = e.deleted || readOnly;
    priv.addEventListener('click', () => changeFlags([e], x => ({ private: !x.private }), e.private ? 'toast.privateCleared' : 'toast.privateSet'));
    const del = el('button', e.deleted ? '' : 'danger', e.deleted ? t('row.restore') : t('row.delete'));
    del.disabled = readOnly;
    del.addEventListener('click', () => changeFlags([e], x => ({ deleted: !x.deleted }), e.deleted ? 'toast.restored' : 'toast.deleted'));
    actions.append(priv, del);
    if ((e.type === 'speech' || e.type === 'note') && !e.deleted && !readOnly) {
        const split = el('button', '', t('row.split'));
        split.addEventListener('click', () => li.split());
        actions.appendChild(split);
    }

    li.append(check, time, badge, body, actions);
    return li;
}

function renderTimeline() {
    const shown = visibleEvents();
    const screenshots = shown.filter(e => e.type === 'screenshot' && e.file);
    $('timeline').replaceChildren(...shown.map(e => renderEvent(e, screenshots)));

    const ids = new Set(state.day.events.map(e => e.id));
    for (const id of [...state.selected]) if (!ids.has(id)) state.selected.delete(id);

    const empty = $('empty');
    if (state.day.events.length === 0) { empty.hidden = false; empty.textContent = t('empty.day'); }
    else if (shown.length === 0) { empty.hidden = false; empty.textContent = t('empty.filter'); }
    else empty.hidden = true;

    $('day-warning').hidden = !state.day.readOnly;
    $('purge').hidden = !state.day.events.some(e => e.deleted);
    const select = $('day-select');
    if (select.value !== state.day.key) select.value = state.day.key;
    $('select-all').checked = shown.length > 0 && shown.every(e => state.selected.has(e.id));
    renderBulk();
}

function renderBulk() {
    const n = state.selected.size;
    $('bulk').hidden = n === 0;
    $('bulk-count').textContent = t('bulk.selected', { n });
    $('select-all').checked = visibleEvents().length > 0 && visibleEvents().every(e => state.selected.has(e.id));
}

function selectedEvents() {
    return state.day.events.filter(e => state.selected.has(e.id));
}

function renderBar() {
    const inc = includedEvents(state.day);
    const c = countsOf(inc);
    const one = (n, key) => t(n === 1 ? `bar.${key}.one` : `bar.${key}.many`, { n });
    const priv = state.day.events.filter(e => e.private && !e.deleted).length;
    const del = state.day.events.filter(e => e.deleted).length;
    $('bar-main').textContent = inc.length === 0 ? t('bar.none') : inc.length === 1 ? t('bar.one') : t('bar.many', { n: inc.length });
    $('bar-detail').textContent = t('bar.detail', {
        speech: c.speech, screenshots: one(c.screenshot, 'screenshot'), files: one(c.file, 'file'), notes: one(c.note, 'note'), priv, del
    });
    $('zip-main').disabled = inc.length === 0;
}

function render() {
    renderTimeline();
    renderBar();
}

// ---- Export --------------------------------------------------------------
function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    // Keep the link alive long enough for the browser to read a large archive.
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

async function exportDays(days) {
    await flush();
    const withContent = days.filter(d => includedEvents(d).length);
    if (!withContent.length) { toast(t('export.nothing')); return; }
    if (estimateBytes(withContent) > BLOCK_BYTES) { toast(t('export.block')); return; }
    try {
        const { files } = await buildExport(withContent);
        const blob = zipBlob(files);
        const name = exportName(withContent);
        let kept = true;
        try {
            if (withContent.length === 1) await withContent[0].writeExport(name, blob);
            else await state.store.writeExport(name, blob);
        } catch {
            kept = false;
        }
        download(blob, name);
        toast(t(kept ? 'export.saved' : 'export.savedDownloadOnly', { name }));
    } catch (err) {
        toast(t('export.failed', { error: err.message }));
    }
}

async function openExportDialog() {
    await flush();
    const keys = await state.store.listDays();
    const list = $('export-days');
    const loaded = [];
    for (const key of keys) {
        try {
            loaded.push(key === state.day.key ? state.day : await state.store.openDay(key, false));
        } catch {
            // an unreadable day is skipped
        }
    }
    list.replaceChildren(...loaded.map(day => {
        const inc = includedEvents(day);
        const li = el('li');
        const label = el('label');
        const box = el('input');
        box.type = 'checkbox';
        box.value = day.key;
        box.checked = day.key === state.day.key && inc.length > 0;
        box.disabled = inc.length === 0;
        label.append(box, document.createTextNode(` ${day.key} - ${t('export.items', { n: inc.length })} - ${formatSize(estimateBytes([day]))}`));
        li.appendChild(label);
        return li;
    }));
    const days = () => loaded.filter(d => [...list.querySelectorAll('input:checked')].some(b => b.value === d.key));
    const refresh = () => {
        const chosen = days();
        const bytes = estimateBytes(chosen);
        const summary = $('export-summary');
        let text = chosen.length ? t('export.size', { size: formatSize(bytes) }) : t('export.nodays');
        if (bytes > BLOCK_BYTES) text += ` ${t('export.block')}`;
        else if (bytes > WARN_BYTES) text += ` ${t('export.warn')}`;
        summary.textContent = text;
        $('export-go').disabled = !chosen.length || bytes > BLOCK_BYTES;
    };
    list.onchange = refresh;
    $('export-go').onclick = async () => { const chosen = days(); $('export-dialog').close(); await exportDays(chosen); };
    refresh();
    $('export-dialog').showModal();
}

// ---- Days ----------------------------------------------------------------
async function refreshDays() {
    const keys = new Set(await state.store.listDays());
    keys.add(state.todayKey);
    keys.add(state.day.key);
    const select = $('day-select');
    select.replaceChildren(...[...keys].sort().reverse().map(k => {
        const o = el('option', '', k === state.todayKey ? `${k} ${t('toolbar.today')}` : k);
        o.value = k;
        return o;
    }));
    select.value = state.day.key;
}

// A recording that was cut off (for example by a crash) before any text arrived leaves an empty item behind.
async function dropEmptySpeech(day) {
    if (day.readOnly) return;
    const live = state.recording ? state.recording.event.id : null;
    const ids = day.events.filter(e => e.type === 'speech' && !e.text.trim() && e.id !== live).map(e => e.id);
    if (ids.length) await day.remove(ids);
}

async function openDay(key) {
    await flush();
    releaseUrls();
    state.day = await state.store.openDay(key);
    await dropEmptySpeech(state.day);
    state.filter = 'all';
    state.selected.clear();
    document.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', String(c.dataset.filter === 'all')));
    await refreshDays();
    render();
}

function startDayRollover() {
    setInterval(async () => {
        const now = dayKey(new Date());
        if (now === state.todayKey) return;
        const wasViewingToday = state.day.key === state.todayKey;
        state.todayKey = now;
        if (wasViewingToday) await openDay(now); else await refreshDays();
        toast(t('toast.newDay'));
    }, 30000);
}

// ---- Settings ------------------------------------------------------------
function renderSettings() {
    $('set-speech-lang').value = settings.speechLang;
    $('set-ui-lang').value = settings.uiLang;
    $('set-format').value = settings.imageFormat;
    $('set-quality').value = String(settings.imageQuality);
    $('set-quality').disabled = settings.imageFormat === 'png';
    $('set-quality-out').textContent = settings.imageFormat === 'png' ? '' : `${Math.round(settings.imageQuality * 100)}%`;
    $('set-hotkey').value = settings.hotkey;
    $('set-capture-mode').value = settings.captureMode;
    $('region-box').hidden = settings.captureMode !== 'region';
    $('region-status').textContent = settings.region ? t('settings.regionSet') : t('settings.regionNone');
    $('mask-count').textContent = t('settings.masksCount', { n: settings.masks.length });
    widget.render();
}

// Changes how screenshots are taken. A new mode ends the current share so the next screenshot uses the right picker.
function setCaptureMode(mode, { draw = false } = {}) {
    changeSetting({ captureMode: mode });
    if (capture.active) { capture.stop(); updateShareUi(); }
    if (draw && mode === 'region' && !settings.region) startRegionDraw();
}

// Shows a preview of the shared screen and lets the user draw the rectangle every screenshot is cropped to.
async function startRegionDraw() {
    if (!await ensureSharing()) { toast(t('settings.masksNeedShare')); return; }
    try {
        const blob = await capture.grab({ format: 'jpeg', quality: 0.7, masks: [], region: null });
        const bitmap = await createImageBitmap(blob);
        if ($('settings-dialog').open) $('settings-dialog').close();
        maskEditor.open(bitmap, settings.region ? [settings.region] : [], 'region');
    } catch (err) {
        toast(t('toast.captureFailed', { error: err.message }));
    }
}

function changeSetting(patch) {
    const uiChanged = patch.uiLang && patch.uiLang !== settings.uiLang;
    settings = saveSettings({ ...settings, ...patch });
    if (patch.speechLang && state.recording) state.recording.session.setLang(settings.speechLang);
    if (uiChanged) {
        setLang(settings.uiLang);
        applyI18n();
        if (state.day) { refreshDays(); render(); }
        updateShareUi();
    }
    renderSettings();
}

$('open-settings').addEventListener('click', () => { renderSettings(); $('settings-dialog').showModal(); });
$('settings-close').addEventListener('click', () => $('settings-dialog').close());
$('open-privacy').addEventListener('click', () => $('privacy-dialog').showModal());
$('privacy-close').addEventListener('click', () => $('privacy-dialog').close());
$('set-speech-lang').addEventListener('change', e => changeSetting({ speechLang: e.target.value }));
$('set-ui-lang').addEventListener('change', e => changeSetting({ uiLang: e.target.value }));
$('set-format').addEventListener('change', e => changeSetting({ imageFormat: e.target.value }));
$('set-quality').addEventListener('input', e => changeSetting({ imageQuality: Number(e.target.value) }));
$('set-hotkey').addEventListener('change', e => changeSetting({ hotkey: e.target.value }));
$('set-capture-mode').addEventListener('change', e => setCaptureMode(e.target.value));
$('region-clear').addEventListener('click', () => changeSetting({ region: null }));
$('region-open').addEventListener('click', () => startRegionDraw());
$('mask-clear').addEventListener('click', () => changeSetting({ masks: [] }));
$('mask-open').addEventListener('click', async () => {
    if (!await ensureSharing()) { toast(t('settings.masksNeedShare')); return; }
    try {
        const blob = await capture.grab({ format: 'jpeg', quality: 0.7, masks: [] });
        const bitmap = await createImageBitmap(blob);
        $('settings-dialog').close();
        maskEditor.open(bitmap, settings.masks, 'mask');
    } catch (err) {
        toast(t('toast.captureFailed', { error: err.message }));
    }
});

// ---- Start-up ------------------------------------------------------------
function showGate(title, text, primary, onPrimary, secondary, onSecondary) {
    $('app').hidden = true;
    $('bar').hidden = true;
    $('gate').hidden = false;
    $('gate-title').textContent = title;
    $('gate-text').textContent = text;
    const p = $('gate-primary');
    p.textContent = primary || '';
    p.onclick = onPrimary || null;
    p.hidden = !onPrimary;
    const s = $('gate-secondary');
    s.hidden = !secondary;
    if (secondary) { s.textContent = secondary; s.onclick = onSecondary; }
}

async function choose() {
    let handle;
    try {
        handle = await pickFolder();
    } catch (err) {
        if (err.name !== 'AbortError') toast(t('toast.folderFailed', { error: err.message }));
        return;
    }
    try {
        await saveRootHandle(handle);
    } catch {
        toast(t('toast.folderNotRemembered'));
    }
    await start(handle);
}

function showWelcome() {
    showGate(t('gate.welcome.title'), t('gate.welcome.text'), t('gate.welcome.button'), choose);
}

function showResume(handle) {
    showGate(t('gate.resume.title'), t('gate.resume.text', { name: handle.name }),
        t('gate.resume.button'), async () => {
            if (await requestPermission(handle) === 'granted') await start(handle);
        },
        t('gate.resume.other'), choose);
}

async function start(handle) {
    try {
        state.store = new DayStore(handle);
        state.todayKey = dayKey(new Date());
        state.day = await state.store.openDay(state.todayKey);
        await dropEmptySpeech(state.day);
    } catch (err) {
        showGate(t('gate.unusable.title'), t('gate.unusable.text', { error: err.message }), t('gate.welcome.button'), choose);
        return;
    }
    $('folder-label').textContent = handle.name;
    $('gate').hidden = true;
    $('app').hidden = false;
    $('bar').hidden = false;
    await refreshDays();
    render();
    if (!start.rolloverStarted) { start.rolloverStarted = true; startDayRollover(); }
}

async function init() {
    applyI18n();
    if (!('documentPictureInPicture' in window)) revealShotButton();
    renderSettings();
    updateShareUi();
    if (!('showDirectoryPicker' in window)) {
        showGate(t('app.unsupported.title'), t('app.unsupported.text'));
        return;
    }
    let handle;
    try {
        handle = await loadRootHandle();
    } catch {
        handle = null;
    }
    if (!handle) { showWelcome(); return; }
    if (await permissionState(handle) === 'granted') { await start(handle); return; }
    showResume(handle);
}

// ---- Wiring --------------------------------------------------------------
$('shot').addEventListener('click', () => takeScreenshot());
$('zip-main').addEventListener('click', () => exportDays([state.day]));
$('export-more').addEventListener('click', () => openExportDialog().catch(err => toast(t('export.failed', { error: err.message }))));
$('export-cancel').addEventListener('click', () => $('export-dialog').close());
$('open-widget').addEventListener('click', () => widget.open().catch(err => toast(t('toast.widgetFailed', { error: err.message }))));
$('change-folder').addEventListener('click', async () => { await flush(); await choose(); });
$('day-select').addEventListener('change', e => openDay(e.target.value).catch(err => toast(t('toast.dayOpenFailed', { error: err.message }))));

$('purge').addEventListener('click', async () => {
    if (!confirm(t('confirm.purge'))) return;
    try {
        const n = await state.day.purgeDeleted();
        toast(t('toast.purged', { n }));
        render();
    } catch (err) {
        toast(t('toast.purgeFailed', { error: err.message }));
    }
});

$('delete-day').addEventListener('click', async () => {
    const key = state.day.key;
    if (!confirm(t('confirm.deleteDay', { key }))) return;
    try {
        await flush();
        await state.day.destroy();
        releaseUrls();
        state.selected.clear();
        state.day = await state.store.openDay(state.todayKey);
        await refreshDays();
        render();
        toast(t('toast.dayDeleted', { key }));
    } catch (err) {
        toast(t('toast.dayDeleteFailed', { error: err.message }));
    }
});

document.querySelectorAll('.chip').forEach(chip => chip.addEventListener('click', () => {
    state.filter = chip.dataset.filter;
    document.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', String(c === chip)));
    render();
}));

$('search').addEventListener('input', e => { state.search = e.target.value; render(); });

$('select-all').addEventListener('change', e => {
    for (const ev of visibleEvents()) { if (e.target.checked) state.selected.add(ev.id); else state.selected.delete(ev.id); }
    renderTimeline();
});
$('bulk-private').addEventListener('click', () => changeFlags(selectedEvents().filter(e => !e.deleted), () => ({ private: true }), 'toast.privateSet'));
$('bulk-unprivate').addEventListener('click', () => changeFlags(selectedEvents(), () => ({ private: false }), 'toast.privateCleared'));
$('bulk-delete').addEventListener('click', () => changeFlags(selectedEvents(), () => ({ deleted: true }), 'toast.deleted'));
$('bulk-restore').addEventListener('click', () => changeFlags(selectedEvents(), () => ({ deleted: false }), 'toast.restored'));
$('bulk-clear').addEventListener('click', () => { state.selected.clear(); renderTimeline(); });

function selectWhere(predicate) {
    const hits = state.day.events.filter(predicate);
    if (!hits.length) { toast(t('range.none')); return; }
    state.selected = new Set(hits.map(e => e.id));
    renderTimeline();
}

$('range-select').addEventListener('click', () => {
    const [fy, fm, fd] = state.day.key.split('-').map(Number);
    const at = value => {
        if (!value) return null;
        const [h, m] = value.split(':').map(Number);
        return new Date(fy, fm - 1, fd, h, m, 0, 0).getTime();
    };
    const from = at($('range-from').value) ?? -Infinity;
    const to = at($('range-to').value);
    const upper = to === null ? Infinity : to + 59999;
    selectWhere(e => e.start.getTime() >= from && e.start.getTime() <= upper);
});

$('last-select').addEventListener('click', () => {
    const minutes = Math.max(1, Math.min(600, Number($('last-minutes').value) || 30));
    const cutoff = Date.now() - minutes * 60000;
    selectWhere(e => e.end.getTime() >= cutoff);
});

$('note-form').addEventListener('submit', async ev => {
    ev.preventDefault();
    const input = $('note-input');
    if (await addNote(input.value)) input.value = '';
});

$('file-input').addEventListener('change', ev => {
    if (ev.target.files.length) addFiles([...ev.target.files]);
    ev.target.value = '';
});

const drop = $('drop');
['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => { if (e.dataTransfer.files.length) addFiles([...e.dataTransfer.files]); });

init();
