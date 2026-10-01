// Renders the brand art in build/ with Electron's own Chromium, so no image library is needed:
//   icon.svg (48 px and up) + icon-small.svg (16–32 px)  -> icon.ico (all Windows sizes) and icon.png (512)
//   installer-sidebar.svg / installer-header.svg          -> 24-bit .bmp files the NSIS setup window needs
// Usage: npx electron scripts/make-icons.mjs
import { app, BrowserWindow } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';

const BUILD = new URL('../build/', import.meta.url);
const SIZES = [16, 24, 32, 48, 64, 128, 256];
const SMALL = 32; // at or below this size, use the simplified cut
const ORBITRON = new URL('../node_modules/@fontsource/orbitron/files/orbitron-latin-700-normal.woff2', import.meta.url);

const svgFile = (name) => readFileSync(new URL(name, BUILD), 'utf8')
    .replace('__ORBITRON__', () => readFileSync(ORBITRON).toString('base64'));

/** Draws the SVG on a canvas in the hidden page. Returns PNG bytes, or raw RGBA when `raw` is set. */
async function render(win, svg, width, height, { raw = false } = {}) {
    const result = await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => setTimeout(() => {
            const canvas = document.createElement('canvas');
            canvas.width = ${width};
            canvas.height = ${height};
            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, ${width}, ${height});
            if (!${raw}) return resolve(canvas.toDataURL('image/png').split(',')[1]);
            const data = ctx.getImageData(0, 0, ${width}, ${height}).data;
            let binary = '';
            for (let i = 0; i < data.length; i += 8192) binary += String.fromCharCode(...data.subarray(i, i + 8192));
            resolve(btoa(binary));
        }, 100); // embedded fonts settle after load
        img.onerror = () => reject(new Error('SVG failed to load'));
        img.src = 'data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}';
    })`);
    return Buffer.from(result, 'base64');
}

/** An .ico is a directory of entries; Windows Vista+ accepts PNG data in each entry. */
function packIco(entries) {
    const header = Buffer.alloc(6);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(entries.length, 4);
    const dir = Buffer.alloc(16 * entries.length);
    let offset = 6 + dir.length;
    entries.forEach(({ size, png }, i) => {
        const at = i * 16;
        dir.writeUInt8(size >= 256 ? 0 : size, at);
        dir.writeUInt8(size >= 256 ? 0 : size, at + 1);
        dir.writeUInt16LE(1, at + 4);
        dir.writeUInt16LE(32, at + 6);
        dir.writeUInt32LE(png.length, at + 8);
        dir.writeUInt32LE(offset, at + 12);
        offset += png.length;
    });
    return Buffer.concat([header, dir, ...entries.map((e) => e.png)]);
}

/** 24-bit bottom-up BMP (what NSIS's header and sidebar images must be). */
function toBmp(rgba, width, height) {
    const rowSize = Math.ceil((width * 3) / 4) * 4;
    const pixels = Buffer.alloc(rowSize * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const src = (y * width + x) * 4;
            const dst = (height - 1 - y) * rowSize + x * 3;
            pixels[dst] = rgba[src + 2];
            pixels[dst + 1] = rgba[src + 1];
            pixels[dst + 2] = rgba[src];
        }
    }
    const header = Buffer.alloc(54);
    header.write('BM', 0);
    header.writeUInt32LE(54 + pixels.length, 2);
    header.writeUInt32LE(54, 10);
    header.writeUInt32LE(40, 14);
    header.writeInt32LE(width, 18);
    header.writeInt32LE(height, 22);
    header.writeUInt16LE(1, 26);
    header.writeUInt16LE(24, 28);
    header.writeUInt32LE(pixels.length, 34);
    return Buffer.concat([header, pixels]);
}

app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false });
    await win.loadURL('about:blank');

    const full = svgFile('icon.svg');
    const small = svgFile('icon-small.svg');
    const entries = [];
    for (const size of SIZES) entries.push({ size, png: await render(win, size <= SMALL ? small : full, size, size) });
    writeFileSync(new URL('icon.ico', BUILD), packIco(entries));
    writeFileSync(new URL('icon.png', BUILD), await render(win, full, 512, 512));

    // The setup images have stencil text: an SVG drawn as an <img> cannot use web fonts, so these are
    // laid out as a real page (inline SVG + the font loaded by the document) and captured.
    for (const [name, width, height] of [['installer-sidebar', 164, 314], ['installer-header', 150, 57]]) {
        const page = new BrowserWindow({ show: false, width, height, useContentSize: true, frame: false, webPreferences: { offscreen: true } });
        page.webContents.setZoomFactor(1);
        await page.loadURL(`data:text/html;base64,${Buffer.from(`<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;overflow:hidden">${svgFile(`${name}.svg`)}</body></html>`).toString('base64')}`);
        await page.webContents.executeJavaScript('document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 200)))');
        const shot = (await page.webContents.capturePage({ x: 0, y: 0, width, height })).resize({ width, height, quality: 'best' });
        page.destroy();
        const bgra = shot.toBitmap();
        const rgba = Buffer.alloc(bgra.length);
        for (let i = 0; i < bgra.length; i += 4) {
            rgba[i] = bgra[i + 2];
            rgba[i + 1] = bgra[i + 1];
            rgba[i + 2] = bgra[i];
            rgba[i + 3] = 255;
        }
        writeFileSync(new URL(`${name}.bmp`, BUILD), toBmp(rgba, width, height));
        writeFileSync(new URL(`preview-${name}.png`, BUILD), shot.resize({ width: width * 2, height: height * 2 }).toPNG());
    }
    console.log('brand art: icon.ico, icon.png, installer-sidebar.bmp, installer-header.bmp');
    app.quit();
}).catch((error) => {
    console.error('make-icons failed:', error);
    app.exit(1);
});
