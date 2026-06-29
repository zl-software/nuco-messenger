// Typed i18n keys. Any key that does not exist in en.json becomes a TypeScript error at the
// call site, and de.json is kept structurally identical (enforced by the parity check).

import 'i18next';
import type en from './locales/en.json';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: {
      translation: typeof en;
    };
  }
}
