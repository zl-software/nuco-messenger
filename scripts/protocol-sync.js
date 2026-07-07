// Vendors the built @nuco/protocol package into vendor/protocol so EAS cloud builds work.
//
// The protocol lives in the sibling repo ../protocol (the single source of truth), but EAS
// only uploads this repo, so a file:../protocol dependency resolves to a dangling symlink
// on the build worker. The dependency therefore points at the committed copy in
// vendor/protocol, and this script keeps that copy in sync.
//
// Plain JavaScript (like reset-project.js) so it stays out of the app's tsc program, which
// has no Node typings. Validated by running.
//
// Run: npm run protocol:sync    (rebuilds ../protocol and refreshes vendor/protocol)
//      npm run protocol:check   (fails if vendor/protocol drifted from ../protocol)
//
// The check passes with a note when ../protocol does not exist (e.g. a checkout of this
// repo alone); syncing requires the sibling repo.

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const appRoot = path.resolve(__dirname, '..');
const protocolRoot = path.resolve(appRoot, '..', 'protocol');
const vendorRoot = path.resolve(appRoot, 'vendor', 'protocol');
const checkOnly = process.argv.includes('--check');

const VENDOR_README = [
  'GENERATED, do not edit. This is the built @nuco/protocol package, vendored from the',
  'sibling protocol repo so EAS cloud builds (which upload only this repo) can resolve it.',
  'After changing the protocol, run: npm run protocol:sync',
  '',
].join('\n');

function listFiles(root, dir = '') {
  const out = [];
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(root, rel));
    else out.push(rel);
  }
  return out.sort();
}

function sameContent(a, b) {
  return fs.existsSync(a) && fs.existsSync(b) && fs.readFileSync(a).equals(fs.readFileSync(b));
}

// The vendored copy is pre-built, so its package.json must carry no scripts: npm runs a
// file: dependency's prepare at install time, and the tsc build would fail (and is not
// wanted) without src and tsconfig, both locally and on the EAS worker.
function vendorPackageJson() {
  const pkg = JSON.parse(fs.readFileSync(path.join(protocolRoot, 'package.json'), 'utf8'));
  delete pkg.scripts;
  delete pkg.devDependencies;
  return JSON.stringify(pkg, null, 2) + '\n';
}

if (!fs.existsSync(protocolRoot)) {
  if (checkOnly) {
    console.log('protocol check skipped: ../protocol not present in this checkout.');
    process.exit(0);
  }
  console.error(`Cannot sync: ${protocolRoot} does not exist.`);
  process.exit(1);
}

if (!checkOnly) {
  execFileSync('npm', ['run', 'build'], { cwd: protocolRoot, stdio: 'inherit' });
}

const sourceDist = path.join(protocolRoot, 'dist');
if (!fs.existsSync(sourceDist)) {
  console.error('Cannot compare: ../protocol/dist is not built. Run: npm --prefix ../protocol run build');
  process.exit(1);
}

if (checkOnly) {
  const wantedDist = listFiles(sourceDist).map((f) => path.join('dist', f));
  const have = fs.existsSync(vendorRoot)
    ? listFiles(vendorRoot).filter((f) => f !== 'README.md')
    : [];
  const vendorPkg = path.join(vendorRoot, 'package.json');
  const drifted =
    JSON.stringify(['package.json', ...wantedDist].sort()) !== JSON.stringify([...have].sort()) ||
    !fs.existsSync(vendorPkg) ||
    fs.readFileSync(vendorPkg, 'utf8') !== vendorPackageJson() ||
    !wantedDist.every((f) => sameContent(path.join(protocolRoot, f), path.join(vendorRoot, f)));
  if (drifted) {
    console.error('vendor/protocol has drifted from ../protocol. Run: npm run protocol:sync');
    process.exit(1);
  }
  console.log('protocol vendor OK: vendor/protocol matches ../protocol.');
  process.exit(0);
}

fs.rmSync(vendorRoot, { recursive: true, force: true });
fs.mkdirSync(path.join(vendorRoot, 'dist'), { recursive: true });
fs.writeFileSync(path.join(vendorRoot, 'package.json'), vendorPackageJson());
fs.cpSync(sourceDist, path.join(vendorRoot, 'dist'), { recursive: true });
fs.writeFileSync(path.join(vendorRoot, 'README.md'), VENDOR_README);
console.log(`Synced ${listFiles(vendorRoot).length} files into vendor/protocol.`);
