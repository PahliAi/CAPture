// Safety net: if the application scripts have not started a few seconds after the page loaded
// (for example because one of them could not be downloaded), say so instead of showing a blank page.
setTimeout(() => {
    if (window.__captureStarted) return;
    const box = document.getElementById('gate');
    if (!box) return;
    box.hidden = false;
    document.getElementById('gate-title').textContent = 'CAPture could not start / CAPture kon niet starten';
    document.getElementById('gate-text').textContent = 'Reload the page. If this keeps happening, check your connection. / Laad de pagina opnieuw. Blijft dit gebeuren, controleer dan je verbinding.';
    document.getElementById('gate-primary').hidden = true;
    document.getElementById('gate-secondary').hidden = true;
}, 8000);
