// Mapping from retention values and system message rows to i18n keys. The canonical home
// of the seconds-to-option-label mapping used by the chat screen, the chats list, and the
// contact detail screen.

import type { MessageDirection, MessageKind } from '@/db/repos/messages';

export type RetentionOptionKey =
  | 'retention.optionOff'
  | 'retention.option24h'
  | 'retention.option7d'
  | 'retention.option30d';

export function retentionKey(seconds: number): RetentionOptionKey {
  if (seconds <= 0) return 'retention.optionOff';
  if (seconds <= 86400) return 'retention.option24h';
  if (seconds <= 604800) return 'retention.option7d';
  return 'retention.option30d';
}

export type SystemMessageI18nKey =
  | 'retention.systemRequestIn'
  | 'retention.systemRequestInOff'
  | 'retention.systemRequestOut'
  | 'retention.systemRequestOutOff'
  | 'retention.systemChangedIn'
  | 'retention.systemChangedInOff'
  | 'retention.systemChangedOut'
  | 'retention.systemChangedOutOff'
  | 'retention.systemDeclinedIn'
  | 'retention.systemDeclinedOut'
  | 'retention.systemCanceledIn'
  | 'retention.systemCanceledOut'
  | 'call.rowOutgoing'
  | 'call.rowIncoming'
  | 'call.rowMissedIn'
  | 'call.rowMissedOut'
  | 'call.rowBusyOut'
  | 'call.rowCanceledOut'
  | 'call.rowDeclinedIn'
  | 'call.rowDeclinedOut'
  | 'call.rowFailed';

// The i18n key for a system message row. The caller interpolates { name, value, duration }.
// Turning the timer off has dedicated keys so the copy never reads "disappear after Off".
// For call rows the direction is the call direction and the body is a duration or a marker
// token (see MessageKind in the messages repo).
export function systemMessageKey(
  kind: Exclude<MessageKind, 'text'>,
  direction: MessageDirection,
  body: string | null,
): SystemMessageI18nKey {
  const seconds = body != null ? Number(body) : null;
  const off = seconds != null && seconds <= 0;
  const incoming = direction === 'in';
  switch (kind) {
    case 'retention/request':
      if (incoming) return off ? 'retention.systemRequestInOff' : 'retention.systemRequestIn';
      return off ? 'retention.systemRequestOutOff' : 'retention.systemRequestOut';
    case 'retention/changed':
      if (incoming) return off ? 'retention.systemChangedInOff' : 'retention.systemChangedIn';
      return off ? 'retention.systemChangedOutOff' : 'retention.systemChangedOut';
    case 'retention/declined':
      return incoming ? 'retention.systemDeclinedIn' : 'retention.systemDeclinedOut';
    case 'retention/canceled':
      return incoming ? 'retention.systemCanceledIn' : 'retention.systemCanceledOut';
    case 'call/outgoing':
      return 'call.rowOutgoing';
    case 'call/incoming':
      return 'call.rowIncoming';
    case 'call/missed':
      if (body === 'error') return 'call.rowFailed';
      if (incoming) return 'call.rowMissedIn';
      if (body === 'busy') return 'call.rowBusyOut';
      if (body === 'canceled') return 'call.rowCanceledOut';
      return 'call.rowMissedOut';
    case 'call/declined':
      return incoming ? 'call.rowDeclinedIn' : 'call.rowDeclinedOut';
  }
}

// m:ss for short calls, h:mm:ss past an hour. Pure so it renders identically in the chat
// timeline and the chats list preview.
export function formatCallDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  const two = (n: number): string => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(rest)}` : `${m}:${two(rest)}`;
}

// The interpolation value for a call row body ('' for non duration bodies, so the key
// templates can always reference {{duration}}).
export function callDurationParam(kind: MessageKind, body: string | null): string {
  if ((kind === 'call/outgoing' || kind === 'call/incoming') && body != null && /^\d+$/.test(body)) {
    return formatCallDuration(Number(body));
  }
  return '';
}
