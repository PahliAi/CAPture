// Full-size screenshot viewer: previous/next, zoom, keyboard control.
import { t } from './i18n.js';

const pad = n => String(n).padStart(2, '0');

export function createViewer({ getUrl }) {
    const dlg = document.getElementById('viewer');
    const img = document.getElementById('viewer-img');
    const counter = document.getElementById('viewer-counter');
    const caption = document.getElementById('viewer-caption');
    let items = [];
    let index = 0;

    async function show(i) {
        index = (i + items.length) % items.length;
        const e = items[index];
        counter.textContent = t('viewer.counter', { i: index + 1, n: items.length });
        caption.textContent = `${pad(e.start.getHours())}:${pad(e.start.getMinutes())}:${pad(e.start.getSeconds())} - ${e.name}`;
        img.removeAttribute('src');
        img.alt = '';
        try {
            img.src = await getUrl(e);
        } catch {
            img.alt = t('row.imageMissing');
        }
    }

    const toggleZoom = () => dlg.classList.toggle('zoomed');

    document.getElementById('viewer-prev').addEventListener('click', () => show(index - 1));
    document.getElementById('viewer-next').addEventListener('click', () => show(index + 1));
    document.getElementById('viewer-zoom').addEventListener('click', toggleZoom);
    document.getElementById('viewer-close').addEventListener('click', () => dlg.close());
    img.addEventListener('click', toggleZoom);
    dlg.addEventListener('keydown', ev => {
        if (ev.key === 'ArrowRight') { ev.preventDefault(); show(index + 1); }
        else if (ev.key === 'ArrowLeft') { ev.preventDefault(); show(index - 1); }
        else if (ev.key === 'z' || ev.key === 'Z' || ev.key === '+') { ev.preventDefault(); toggleZoom(); }
    });

    return {
        open(list, startIndex) {
            if (!list.length) return;
            items = list;
            dlg.classList.remove('zoomed');
            dlg.showModal();
            show(startIndex);
        }
    };
}
