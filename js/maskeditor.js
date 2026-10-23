// Lets the user draw rectangles on a preview of the shared screen. Rectangles are stored as fractions of the frame.
// kind 'mask': any number of areas that are blacked out. kind 'region': one rectangle that screenshots are cropped to.
import { t } from './i18n.js';

export function createMaskEditor({ onSave, onClosed = () => {} }) {
    const dlg = document.getElementById('mask-dialog');
    const canvas = document.getElementById('mask-canvas');
    const ctx = canvas.getContext('2d');
    let bitmap = null;
    let kind = 'mask';
    let work = [];
    let drag = null;
    let origin = null;
    let saved = false;

    function redraw() {
        if (!bitmap) return;
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const rects = drag ? [...work, drag] : work;
        if (kind === 'region') {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            for (const m of rects) {
                const x = m.x * canvas.width;
                const y = m.y * canvas.height;
                const w = m.w * canvas.width;
                const h = m.h * canvas.height;
                ctx.drawImage(bitmap, m.x * bitmap.width, m.y * bitmap.height, m.w * bitmap.width, m.h * bitmap.height, x, y, w, h);
                ctx.strokeStyle = '#f0dc9a';
                ctx.lineWidth = 2;
                ctx.strokeRect(x, y, w, h);
            }
            return;
        }
        for (const m of rects) {
            const x = m.x * canvas.width;
            const y = m.y * canvas.height;
            const w = m.w * canvas.width;
            const h = m.h * canvas.height;
            ctx.fillStyle = 'rgba(0, 0, 0, 0.88)';
            ctx.fillRect(x, y, w, h);
            ctx.strokeStyle = '#f0dc9a';
            ctx.lineWidth = 2;
            ctx.strokeRect(x, y, w, h);
        }
    }

    function point(ev) {
        const box = canvas.getBoundingClientRect();
        return {
            x: Math.min(1, Math.max(0, (ev.clientX - box.left) / box.width)),
            y: Math.min(1, Math.max(0, (ev.clientY - box.top) / box.height))
        };
    }

    canvas.addEventListener('pointerdown', ev => {
        origin = point(ev);
        drag = { x: origin.x, y: origin.y, w: 0, h: 0 };
        canvas.setPointerCapture(ev.pointerId);
    });
    canvas.addEventListener('pointermove', ev => {
        if (!origin) return;
        const p = point(ev);
        drag = { x: Math.min(origin.x, p.x), y: Math.min(origin.y, p.y), w: Math.abs(p.x - origin.x), h: Math.abs(p.y - origin.y) };
        redraw();
    });
    canvas.addEventListener('pointerup', () => {
        if (drag && drag.w > 0.005 && drag.h > 0.005) {
            if (kind === 'region') work = [drag]; else work.push(drag);
        }
        origin = null;
        drag = null;
        redraw();
    });

    document.getElementById('mask-undo').addEventListener('click', () => { work.pop(); redraw(); });
    document.getElementById('mask-cancel').addEventListener('click', () => dlg.close());
    document.getElementById('mask-save').addEventListener('click', () => { onSave(kind, work.map(m => ({ ...m }))); saved = true; dlg.close(); });
    // Closing by any route (Save, Cancel, Escape) ends here; the caller learns whether the areas were saved.
    dlg.addEventListener('close', () => { const wasSaved = saved; saved = false; onClosed(kind, wasSaved); });

    return {
        // `target` names what the areas are drawn for (a screen, or windows and tabs); it is shown in the title.
        open(previewBitmap, rects, openKind = 'mask', target = '') {
            bitmap = previewBitmap;
            kind = openKind;
            saved = false;
            work = rects.map(m => ({ ...m }));
            drag = null;
            document.getElementById('mask-title').textContent = kind === 'region'
                ? t('mask.regionTitle')
                : (target ? t('mask.titleFor', { target }) : t('mask.title'));
            document.getElementById('mask-hint').textContent = t(kind === 'region' ? 'mask.regionHint' : 'mask.hint');
            canvas.width = 800;
            canvas.height = Math.max(100, Math.round(800 * bitmap.height / bitmap.width));
            dlg.showModal();
            redraw();
        }
    };
}
