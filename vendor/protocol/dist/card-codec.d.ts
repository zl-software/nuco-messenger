import type { ContactCard } from './qr.js';
export declare const CARD_QR_PREFIX = "NC4:";
export declare const CARD_QR_MAX_LEN = 3391;
export declare function encodeContactCardQr(card: ContactCard): string;
export declare function decodeContactCardQr(data: string): ContactCard | null;
//# sourceMappingURL=card-codec.d.ts.map