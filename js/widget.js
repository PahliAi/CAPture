// The floating always-on-top widget (Document Picture-in-Picture): four icons.
// Left-click acts (screenshot, start/stop speech, add files, write a note); right-click opens the options of that icon.
import { t } from './i18n.js';

const SVG_OPEN = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round">';
const ICONS = {
    cam: `${SVG_OPEN}<path d="M3 8h4l2-3h6l2 3h4v11H3z"/><circle cx="12" cy="13" r="3.5"/></svg>`,
    mic: `${SVG_OPEN}<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6"/></svg>`,
    file: `${SVG_OPEN}<path d="M3 6h6l2 2h10v11H3z"/></svg>`,
    note: `${SVG_OPEN}<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 7l4 4"/></svg>`
};

const BASE_SIZE = { width: 296, height: 92 };
const NOTE_SIZE = { width: 460, height: 340 };
const MENU_HEIGHT = 300;

const CSS = `
    body { margin: 0; padding: 6px; font-family: "Segoe UI", sans-serif; background: #f1ede3; color: #1d1b16; box-sizing: border-box; overflow: hidden; }
    .row { display: flex; gap: 6px; }
    .icon { flex: 1; height: 70px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; padding: 0; border: 1px solid #1d1b16; background: #faf8f2; border-radius: 2px; cursor: pointer; color: #1d1b16; font: inherit; }
    .icon:hover { background: #fff; }
    .icon small { font-size: 11px; line-height: 1; letter-spacing: 0.3px; color: #6a6454; min-height: 11px; }
    .icon.rec { background: #b8321f; border-color: #b8321f; color: #fff; }
    .icon.rec small { color: #fff; }
    .icon.ok, .icon.ok:hover { background: #2e9e4f; border-color: #2e9e4f; color: #fff; }
    .icon.ok small { color: #fff; }
    .icon.fail, .icon.fail:hover { background: #b8321f; border-color: #b8321f; color: #fff; }
    .icon.fail small { color: #fff; }
    .over { background: #f0dc9a; }
    .editor { position: absolute; inset: 0; display: flex; flex-direction: column; gap: 8px; padding: 8px; background: #f1ede3; z-index: 10; box-sizing: border-box; }
    .editor h2 { margin: 0; font: 600 14px "Segoe UI", sans-serif; }
    .editor textarea { flex: 1; resize: none; padding: 8px; border: 1px solid #cbc3b0; border-radius: 2px; background: #faf8f2; color: #1d1b16; font: 14px/1.45 "Segoe UI", sans-serif; }
    .editor textarea:focus { outline: 2px solid #2d5a4c; border-color: #2d5a4c; }
    .editor .buttons { display: flex; justify-content: flex-end; gap: 8px; }
    .editor button { padding: 6px 16px; border: 1px solid #1d1b16; border-radius: 2px; background: #faf8f2; color: #1d1b16; font: 13px "Segoe UI", sans-serif; cursor: pointer; }
    .editor button:hover:not(:disabled) { background: #fff; }
    .editor button.primary { background: #2d5a4c; border-color: #2d5a4c; color: #fff; }
    .editor button:disabled { opacity: 0.5; cursor: default; }
    .editor button.fail { background: #b8321f; border-color: #b8321f; color: #fff; }
`;

// Icons are constant SVG text; they are parsed as XML into the widget's document (no HTML injection involved).
const svgNode = (d, name) => d.importNode(new DOMParser().parseFromString(ICONS[name], 'image/svg+xml').documentElement, true);

export function createWidget(api) {
    let win = null;
    let els = null;
    let menu = null;
    let restoreSize = null;
    let editor = null;
    let editorSize = null;

    const isOpen = () => !!win && !win.closed;

    function closeMenu() {
        if (!menu) return;
        menu.remove();
        menu = null;
        if (restoreSize && isOpen()) {
            try { win.resizeTo(restoreSize.width, restoreSize.height); } catch { /* the browser does not allow resizing */ }
        }
        restoreSize = null;
    }

    // items: [{ label, checked?, run }] or 'separator'.
    function showMenu(items) {
        closeMenu();
        const d = win.document;
        restoreSize = { width: win.outerWidth, height: win.outerHeight };
        try { win.resizeTo(restoreSize.width, Math.max(restoreSize.height, MENU_HEIGHT)); } catch { /* the menu may be clipped */ }
        menu = d.createElement('div');
        menu.className = 'menu';
        menu.setAttribute('role', 'menu');
        for (const item of items) {
            if (item === 'separator') { menu.appendChild(d.createElement('hr')); continue; }
            const b = d.createElement('button');
            b.type = 'button';
            b.textContent = item.label;
            b.setAttribute('role', item.checked === undefined ? 'menuitem' : 'menuitemradio');
            if (item.checked !== undefined) b.setAttribute('aria-checked', String(item.checked));
            b.addEventListener('click', () => { closeMenu(); item.run(); });
            menu.appendChild(b);
        }
        d.body.appendChild(menu);
        menu.querySelector('button')?.focus();
    }

    function cameraMenu() {
        const s = api.getState();
        const mode = (m, key) => ({ label: t(`widget.menu.${key}`), checked: s.mode === m, run: () => api.setMode(m) });
        const items = [
            { label: t('widget.menu.switch'), run: () => api.switchNow() },
            'separator',
            mode('screen', 'screen'), mode('window', 'window'), mode('tab', 'tab'), mode('region', 'region'), mode('ask', 'ask')
        ];
        if (s.mode === 'region') items.push('separator', { label: t('widget.menu.draw'), run: () => api.drawRegion() });
        if (s.sharing) items.push('separator', { label: t('widget.menu.off'), run: () => api.stopSharing() });
        showMenu(items);
    }

    function micMenu() {
        const s = api.getState();
        showMenu([
            { label: t('settings.lang.nl'), checked: s.lang === 'nl-NL', run: () => api.setLang('nl-NL') },
            { label: t('settings.lang.en'), checked: s.lang === 'en-US', run: () => api.setLang('en-US') }
        ]);
    }

    // A larger writing area for a note: the widget grows while it is open and returns to its size afterwards.
    function openEditor() {
        if (editor) { editor.querySelector('textarea').focus(); return; }
        const d = win.document;
        closeMenu();
        editorSize = { width: win.outerWidth, height: win.outerHeight };
        try { win.resizeTo(Math.max(editorSize.width, NOTE_SIZE.width), Math.max(editorSize.height, NOTE_SIZE.height)); } catch { /* the browser does not allow resizing */ }

        editor = d.createElement('div');
        editor.className = 'editor';
        editor.setAttribute('role', 'dialog');
        editor.setAttribute('aria-label', t('widget.noteTitle'));
        const title = d.createElement('h2');
        title.textContent = t('widget.noteTitle');
        const text = d.createElement('textarea');
        text.id = 'w-note-text';
        text.placeholder = t('widget.notePlaceholder');
        const buttons = d.createElement('div');
        buttons.className = 'buttons';
        const cancel = d.createElement('button');
        cancel.type = 'button';
        cancel.id = 'w-note-cancel';
        cancel.textContent = t('widget.noteCancel');
        const save = d.createElement('button');
        save.type = 'button';
        save.id = 'w-note-save';
        save.className = 'primary';
        save.textContent = t('widget.noteSave');
        save.title = 'Ctrl+Enter';
        save.disabled = true;
        buttons.append(cancel, save);
        editor.append(title, text, buttons);
        d.body.appendChild(editor);
        text.focus();

        const doSave = async () => {
            if (save.disabled) return;
            save.disabled = true;
            const saved = await api.addNote(text.value);
            if (saved) { closeEditor(); return; }
            save.disabled = !text.value.trim();
            save.classList.add('fail');
            win.setTimeout(() => save.classList.remove('fail'), 1000);
        };
        text.addEventListener('input', () => { save.disabled = !text.value.trim(); });
        text.addEventListener('keydown', ev => {
            if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); doSave(); }
        });
        cancel.addEventListener('click', closeEditor);
        save.addEventListener('click', doSave);
    }

    function closeEditor() {
        if (!editor) return;
        editor.remove();
        editor = null;
        if (editorSize && isOpen()) {
            try { win.resizeTo(editorSize.width, editorSize.height); } catch { /* the browser does not allow resizing */ }
        }
        editorSize = null;
    }

    function build(d) {
        d.title = 'CAPture';
        const style = d.createElement('style');
        style.textContent = CSS;
        d.head.appendChild(style);

        const row = d.createElement('div');
        row.className = 'row';
        d.body.appendChild(row);

        const icon = (name, onClick, onMenu) => {
            const b = d.createElement('button');
            b.type = 'button';
            b.className = 'icon';
            b.id = `w-${name}`;
            b.append(svgNode(d, name), d.createElement('small'));
            b.addEventListener('click', () => { closeMenu(); onClick(); });
            b.addEventListener('contextmenu', ev => {
                ev.preventDefault();
                if (onMenu) onMenu(); else closeMenu();
            });
            row.appendChild(b);
            return b;
        };

        const fileInput = d.createElement('input');
        fileInput.type = 'file';
        fileInput.multiple = true;
        fileInput.hidden = true;
        fileInput.addEventListener('change', () => {
            if (fileInput.files.length) api.addFiles([...fileInput.files]);
            fileInput.value = '';
        });
        d.body.appendChild(fileInput);

        els = {
            cam: icon('cam', () => api.camera(), cameraMenu),
            mic: icon('mic', () => api.toggleMic(), micMenu),
            file: icon('file', () => fileInput.click(), null),
            note: icon('note', () => openEditor(), null)
        };

        d.addEventListener('keydown', ev => {
            if (ev.key === 'Escape') { if (menu) closeMenu(); else closeEditor(); }
        });
        d.addEventListener('click', ev => { if (menu && !menu.contains(ev.target)) closeMenu(); });
        d.body.addEventListener('dragover', ev => { ev.preventDefault(); d.body.classList.add('over'); });
        d.body.addEventListener('dragleave', () => d.body.classList.remove('over'));
        d.body.addEventListener('drop', ev => {
            ev.preventDefault();
            d.body.classList.remove('over');
            if (ev.dataTransfer.files.length) api.addFiles([...ev.dataTransfer.files]);
        });
    }

    function render() {
        if (!isOpen() || !els) return;
        const s = api.getState();
        const caption = el => el.querySelector('small');

        els.cam.title = `${t('widget.cameraTitle')} (${t(`widget.mode.${s.mode}`)}${s.sharing ? ` - ${s.label}` : ''})`;
        els.cam.dataset.sharing = String(s.sharing);
        caption(els.cam).textContent = t(`widget.mode.${s.mode}`);

        els.mic.title = t('widget.micTitle');
        els.mic.classList.toggle('rec', s.recording);
        const mm = String(Math.floor(s.elapsed / 60)).padStart(2, '0');
        const ss = String(s.elapsed % 60).padStart(2, '0');
        caption(els.mic).textContent = s.recording ? `${mm}:${ss}` : s.lang.slice(0, 2).toUpperCase();

        els.file.title = t('widget.fileTitle');
        caption(els.file).textContent = t('widget.fileCaption');

        els.note.title = t('widget.noteTitle');
        caption(els.note).textContent = t('widget.noteCaption');
    }

    // Turns one icon green ('ok') or red ('fail') for a second, as a quiet answer to what the user just did.
    function mark(name, kind = 'ok') {
        if (!isOpen() || !els || !els[name]) return;
        const button = els[name];
        button.classList.add(kind);
        win.setTimeout(() => button.classList.remove(kind), 1000);
    }

    async function open() {
        if (!('documentPictureInPicture' in window)) throw new Error(t('toast.widgetUnsupported'));
        if (isOpen()) { win.focus(); return; }
        const w = await window.documentPictureInPicture.requestWindow(BASE_SIZE);
        win = w;
        build(w.document);
        w.addEventListener('pagehide', () => { if (win === w) { win = null; els = null; menu = null; editor = null; editorSize = null; } });
        render();
    }

    return { open, render, isOpen, mark };
}
