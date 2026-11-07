// Generates build/icon.png (1024), build/icon.ico and build/icon.icns from build/icon.svg by rendering it in a hidden Electron window.
// Run: npx electron tools/make-icons.cjs     (icns needs macOS `iconutil`; on Linux/Windows electron-builder converts icon.png itself.)
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const svg = fs.readFileSync(path.join(root, 'build/icon.svg'), 'utf8');
const SIZES = [16, 32, 48, 64, 128, 256, 512, 1024];

/** Renders the SVG at a size in a hidden window and returns PNG bytes. */
let win = null;
async function render(size) {
  if (!win)
    win = new BrowserWindow({
      show: false,
      width: 1024,
      height: 1024,
      useContentSize: true,
      frame: false,
      transparent: true,
    });
  win.setContentSize(size, size);
  const page = path.join(require('node:os').tmpdir(), `outbreakscope-icon-${size}.html`);
  fs.writeFileSync(
    page,
    `<html><body style="margin:0;background:transparent"><img src="file://${path.join(root, 'build/icon.svg')}" width="${size}" height="${size}"></body></html>`,
  );
  await win.loadFile(page);
  await new Promise((r) => setTimeout(r, 300));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
  return img.resize({ width: size, height: size, quality: 'best' }).toPNG(); // capture is at device-pixel scale (2x on Retina): normalise to the exact size
}

/** Packs PNGs (sizes <= 256) into a Windows .ico (PNG-compressed entries). */
function makeIco(pngs) {
  const entries = Object.entries(pngs).filter(([s]) => Number(s) <= 256);
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  let offset = 6 + 16 * entries.length;
  const dir = [];
  const data = [];
  for (const [size, png] of entries) {
    const e = Buffer.alloc(16);
    e.writeUInt8(Number(size) === 256 ? 0 : Number(size), 0);
    e.writeUInt8(Number(size) === 256 ? 0 : Number(size), 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    dir.push(e);
    data.push(png);
  }
  return Buffer.concat([header, ...dir, ...data]);
}

app.dock?.hide();
app.whenReady().then(async () => {
  try {
    const pngs = {};
    for (const s of SIZES) pngs[s] = await render(s);
    fs.writeFileSync(path.join(root, 'build/icon.png'), pngs[1024]);
    fs.writeFileSync(path.join(root, 'build/icon.ico'), makeIco(pngs));
    if (process.platform === 'darwin') {
      const set = path.join(root, 'build/icon.iconset');
      fs.rmSync(set, { recursive: true, force: true });
      fs.mkdirSync(set);
      const names = {
        16: ['icon_16x16.png'],
        32: ['icon_16x16@2x.png', 'icon_32x32.png'],
        64: ['icon_32x32@2x.png'],
        128: ['icon_128x128.png'],
        256: ['icon_128x128@2x.png', 'icon_256x256.png'],
        512: ['icon_256x256@2x.png', 'icon_512x512.png'],
        1024: ['icon_512x512@2x.png'],
      };
      for (const [s, list] of Object.entries(names))
        for (const n of list) fs.writeFileSync(path.join(set, n), pngs[s]);
      execFileSync('iconutil', ['-c', 'icns', set, '-o', path.join(root, 'build/icon.icns')]);
      fs.rmSync(set, { recursive: true, force: true });
    }
    console.log('icons written');
    app.exit(0);
  } catch (e) {
    console.error('icon generation failed:', e);
    app.exit(1);
  }
});
