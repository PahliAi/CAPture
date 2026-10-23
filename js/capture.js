// Screen capture: one shared screen per session, frames grabbed on demand.

const MIME = { jpeg: 'image/jpeg', webp: 'image/webp', png: 'image/png' };

export function encodeParams(format, quality) {
    const mime = MIME[format] || MIME.jpeg;
    return { mime, quality: mime === MIME.png ? undefined : quality };
}

// Fill each mask rectangle (fractions of the frame) with solid black, so the covered pixels are never stored.
export function applyMasks(ctx, width, height, masks) {
    ctx.fillStyle = '#000';
    for (const m of masks || []) {
        ctx.fillRect(Math.floor(m.x * width), Math.floor(m.y * height), Math.ceil(m.w * width), Math.ceil(m.h * height));
    }
}

// Options for the browser's screen picker. 'window' and 'tab' list only those; 'ask' lists everything.
export function pickerOptions(mode) {
    const base = { audio: false, selfBrowserSurface: 'exclude', surfaceSwitching: 'include' };
    const video = surface => ({ frameRate: { max: 5 }, ...(surface ? { displaySurface: surface } : {}) });
    if (mode === 'window') return { ...base, video: video('window'), monitorTypeSurfaces: 'exclude' };
    if (mode === 'tab') return { ...base, video: video('browser'), monitorTypeSurfaces: 'exclude' };
    if (mode === 'ask') return { ...base, video: video(null), monitorTypeSurfaces: 'include' };
    return { ...base, video: video('monitor'), monitorTypeSurfaces: 'include' };
}

// The part of a frame to keep, in whole pixels, for a region given as fractions of the frame.
export function cropRect(width, height, region) {
    const sx = Math.min(width - 1, Math.max(0, Math.round(region.x * width)));
    const sy = Math.min(height - 1, Math.max(0, Math.round(region.y * height)));
    const sw = Math.max(1, Math.min(width - sx, Math.round(region.w * width)));
    const sh = Math.max(1, Math.min(height - sy, Math.round(region.h * height)));
    return { sx, sy, sw, sh };
}

export class ScreenCapture {
    constructor({ mediaDevices = navigator.mediaDevices, doc = document, onEnded = () => {} } = {}) {
        this.mediaDevices = mediaDevices;
        this.doc = doc;
        this.onEnded = onEnded;
        this.stream = null;
        this.video = null;
    }

    // True once the screen is shared and its video is ready to give frames.
    get active() {
        return !!this.stream && !!this.video && this.stream.getVideoTracks().some(t => t.readyState === 'live');
    }

    get label() {
        const track = this.stream && this.stream.getVideoTracks()[0];
        return track ? track.label : '';
    }

    // What is being shared, as far as the browser tells: the track label and the surface kind (monitor, window, browser).
    get source() {
        const track = this.stream && this.stream.getVideoTracks()[0];
        if (!track) return null;
        const settings = typeof track.getSettings === 'function' ? track.getSettings() : {};
        return { label: track.label || '', surface: settings.displaySurface || '' };
    }

    get size() {
        return this.video ? { width: this.video.videoWidth, height: this.video.videoHeight } : { width: 0, height: 0 };
    }

    // Opens the browser's screen picker. Replaces any current share.
    async start(mode = 'screen') {
        const stream = await this.mediaDevices.getDisplayMedia(pickerOptions(mode));
        this.stop();
        this.stream = stream;
        const track = stream.getVideoTracks()[0];
        track.addEventListener('ended', () => {
            if (this.stream === stream) {
                this.#release();
                this.onEnded();
            }
        });
        const video = this.doc.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.setAttribute('aria-hidden', 'true');
        video.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none';
        this.doc.body.appendChild(video);
        try {
            video.srcObject = stream;
            await video.play();
            if (!video.videoWidth) {
                await new Promise(resolve => video.addEventListener('loadedmetadata', resolve, { once: true }));
            }
        } catch (err) {
            video.remove();
            stream.getTracks().forEach(t => t.stop());
            if (this.stream === stream) this.stream = null;
            throw err;
        }
        this.video = video;
    }

    // Returns an image Blob of the current frame, with mask areas blacked out, cropped to the region if one is given.
    async grab({ format = 'jpeg', quality = 0.85, masks = [], region = null } = {}) {
        if (!this.active || !this.video) throw new Error('Screen sharing is not active');
        const { videoWidth: w, videoHeight: h } = this.video;
        const canvas = this.doc.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(this.video, 0, 0, w, h);
        applyMasks(ctx, w, h, masks);
        let out = canvas;
        if (region) {
            const { sx, sy, sw, sh } = cropRect(w, h, region);
            out = this.doc.createElement('canvas');
            out.width = sw;
            out.height = sh;
            out.getContext('2d').drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
        }
        const { mime, quality: q } = encodeParams(format, quality);
        const blob = await new Promise(resolve => out.toBlob(resolve, mime, q));
        if (!blob) throw new Error('Could not encode the screenshot');
        return blob;
    }

    #release() {
        if (this.video) this.video.remove();
        this.video = null;
        this.stream = null;
    }

    stop() {
        if (this.stream) this.stream.getTracks().forEach(t => t.stop());
        this.#release();
    }
}
