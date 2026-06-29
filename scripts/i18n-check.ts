// Locale parity check. Fails if en.json and de.json do not have exactly the same set of
// keys, so a missing or stray translation is caught in development and CI.
//
// Run: npx tsx scripts/i18n-check.ts

import en from '../src/i18n/locales/en.json';
import de from '../src/i18n/locales/de.json';

function flatten(obj: unknown, prefix = ''): string[] {
  if (typeof obj !== 'object' || obj === null) return [prefix];
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    keys.push(...flatten(v, prefix ? `${prefix}.${k}` : k));
  }
  return keys;
}

const enKeys = new Set(flatten(en));
const deKeys = new Set(flatten(de));

const missingInDe = [...enKeys].filter((k) => !deKeys.has(k));
const extraInDe = [...deKeys].filter((k) => !enKeys.has(k));

if (missingInDe.length > 0 || extraInDe.length > 0) {
  if (missingInDe.length > 0) console.error('Missing in de.json:\n  ' + missingInDe.join('\n  '));
  if (extraInDe.length > 0) console.error('Extra in de.json:\n  ' + extraInDe.join('\n  '));
  process.exit(1);
}

console.log(`i18n parity OK: ${enKeys.size} keys in en and de.`);
