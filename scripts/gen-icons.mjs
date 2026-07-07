// Generates the app icon set from the NucoMark geometry (src/ui/NucoLogo.tsx): an open
// ring (r 10, stroke 2.6, dasharray 46/16, rotated -52deg, round caps) plus a center dot
// (r 3.4), accent #19E3B1 on the app background #0A0B0E. Writes assets/images/* and the
// mark SVG inside assets/expo.icon (whose icon.json supplies the fill and glass settings).
//
// sharp is not a project dependency; run ad hoc with:
//   npm install --no-save sharp && node scripts/gen-icons.mjs
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
const ACCENT = '#19E3B1';
const BG = '#0A0B0E';
const BG_TOP = '#0C0E12';

// Unit-space mark geometry (ring center radius 1, y-down coordinates).
const RING_W = 0.26; // 2.6 / 10
const DOT_R = 0.34; // 3.4 / 10
const THETA0 = -52;
const SWEEP = (46 / (2 * Math.PI * 10)) * 360; // 263.62deg of visible arc
const THETA1 = THETA0 + SWEEP;
const OUTER = 1 + RING_W / 2; // 1.13, the mark's outermost extent

const rad = (deg) => (deg * Math.PI) / 180;
const pt = (cx, cy, S, theta, rho) =>
  `${(cx + rho * S * Math.cos(rad(theta))).toFixed(3)} ${(cy + rho * S * Math.sin(rad(theta))).toFixed(3)}`;

// The ring-with-gap as a single filled path (outer arc, round cap, inner arc, round cap),
// because the Icon Composer renderer is only trusted with plain filled paths, not strokes.
function ringPath(cx, cy, S) {
  const Ro = (OUTER * S).toFixed(3);
  const Ri = ((1 - RING_W / 2) * S).toFixed(3);
  const rc = ((RING_W / 2) * S).toFixed(3);
  return [
    `M ${pt(cx, cy, S, THETA0, OUTER)}`,
    `A ${Ro} ${Ro} 0 1 1 ${pt(cx, cy, S, THETA1, OUTER)}`,
    `A ${rc} ${rc} 0 0 1 ${pt(cx, cy, S, THETA1, 1 - RING_W / 2)}`,
    `A ${Ri} ${Ri} 0 1 0 ${pt(cx, cy, S, THETA0, 1 - RING_W / 2)}`,
    `A ${rc} ${rc} 0 0 1 ${pt(cx, cy, S, THETA0, OUTER)}`,
    'Z',
  ].join(' ');
}

function markSvg(cx, cy, S, color) {
  return (
    `<path d="${ringPath(cx, cy, S)}" fill="${color}"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${(DOT_R * S).toFixed(3)}" fill="${color}"/>`
  );
}

const svg = (size, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${body}</svg>`;

// Scale so the mark's outer diameter is `frac` of the canvas.
const scaleFor = (size, frac) => (frac * size) / (2 * OUTER);

// The app's standard screen gradient plus a faint accent glow behind the mark.
function backgroundBody(size) {
  return (
    `<defs>` +
    `<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="${BG_TOP}"/><stop offset="1" stop-color="${BG}"/>` +
    `</linearGradient>` +
    `<radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">` +
    `<stop offset="0" stop-color="${ACCENT}" stop-opacity="0.13"/>` +
    `<stop offset="1" stop-color="${ACCENT}" stop-opacity="0"/>` +
    `</radialGradient>` +
    `</defs>` +
    `<rect width="${size}" height="${size}" fill="url(#bg)"/>` +
    `<rect width="${size}" height="${size}" fill="url(#glow)"/>`
  );
}

async function render(name, svgText) {
  await sharp(Buffer.from(svgText)).png().toFile(join(OUT, 'images', name));
  console.log('wrote', name);
}

// iOS / store icon: background plus mark at 56% of the canvas.
{
  const Z = 1024;
  const S = scaleFor(Z, 0.56);
  await render('icon.png', svg(Z, backgroundBody(Z) + markSvg(Z / 2, Z / 2, S, ACCENT)));
}

// Android adaptive: the background carries the gradient and glow, the foreground only the
// mark (52% of the canvas keeps it inside the 61% safe zone), monochrome is the white mark.
{
  const Z = 1024;
  const S = scaleFor(Z, 0.52);
  await render('android-icon-background.png', svg(Z, backgroundBody(Z)));
  await render('android-icon-foreground.png', svg(Z, markSvg(Z / 2, Z / 2, S, ACCENT)));
  await render('android-icon-monochrome.png', svg(Z, markSvg(Z / 2, Z / 2, S, '#FFFFFF')));
}

// Splash: the mark alone on transparency (the splash background color is set in app.json).
{
  const Z = 512;
  const S = scaleFor(Z, 0.88);
  await render('splash-icon.png', svg(Z, markSvg(Z / 2, Z / 2, S, ACCENT)));
}

// Favicon: dark rounded tile with the mark, downscaled to 48.
{
  const Z = 512;
  const S = scaleFor(Z, 0.62);
  const body =
    `<rect width="${Z}" height="${Z}" rx="${Z * 0.22}" fill="${BG}"/>` + markSvg(Z / 2, Z / 2, S, ACCENT);
  const buf = await sharp(Buffer.from(svg(Z, body))).resize(48, 48).png().toBuffer();
  writeFileSync(join(OUT, 'images', 'favicon.png'), buf);
  console.log('wrote favicon.png');
}

// The Icon Composer bundle asset: the flat mark alone (the .icon fill supplies the
// background and the system adds the glass treatment).
{
  const Z = 1024;
  const S = scaleFor(Z, 0.56);
  mkdirSync(join(OUT, 'expo.icon', 'Assets'), { recursive: true });
  writeFileSync(join(OUT, 'expo.icon', 'Assets', 'nuco-mark.svg'), svg(Z, markSvg(Z / 2, Z / 2, S, ACCENT)));
  console.log('wrote expo.icon/Assets/nuco-mark.svg');
}
