// Remembers the chosen storage folder between visits (IndexedDB) and handles its permission.
const DB_NAME = 'capture';
const STORE = 'settings';
const KEY = 'rootFolder';

function openDb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function withStore(mode, fn) {
    const db = await openDb();
    try {
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, mode);
            const req = fn(tx.objectStore(STORE));
            tx.oncomplete = () => resolve(req.result);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
    } finally {
        db.close();
    }
}

export const saveRootHandle = handle => withStore('readwrite', s => s.put(handle, KEY));
export const loadRootHandle = () => withStore('readonly', s => s.get(KEY));

export const permissionState = handle => handle.queryPermission({ mode: 'readwrite' });
export const requestPermission = handle => handle.requestPermission({ mode: 'readwrite' });

export function pickFolder() {
    return window.showDirectoryPicker({ id: 'capture-days', mode: 'readwrite' });
}
