// Mapping from retention values and system message rows to i18n keys. The canonical home
// of the seconds-to-label mapping used by the chat screen, the chats list, and the contact
// detail screen.

import type { TFunction } from 'i18next';

import type { MessageDirection, MessageKind } from '@/db/repos/messages';

type RetentionOptionKey =
  | 'retention.optionOff'
  | 'retention.option24h'
  | 'retention.option7d'
  | 'retention.option30d';

// The preset values keep their shipped labels ("24 hours", not "1 day").
const RETENTION_PRESETS: Record<number, RetentionOptionKey> = {
  86400: 'retention.option24h',
  604800: 'retention.option7d',
  2592000: 'retention.option30d',
};

const RETENTION_UNITS = [
  { seconds: 604800, one: 'retention.durationWeeks_one', other: 'retention.durationWeeks_other' },
  { seconds: 86400, one: 'retention.durationDays_one', other: 'retention.durationDays_other' },
  { seconds: 3600, one: 'retention.durationHours_one', other: 'retention.durationHours_other' },
  { seconds: 60, one: 'retention.durationMinutes_one', other: 'retention.durationMinutes_other' },
  { seconds: 1, one: 'retention.durationSeconds_one', other: 'retention.durationSeconds_other' },
] as const;

// The exact localized label for any retention value. Non preset values format by the
// largest unit that divides them exactly ("5 minutes", "3 days", "2 weeks"); the seconds
// unit is a safety net, since the wire allows any integer up to a year. The plural form is
// picked by hand (English and German share the count of exactly 1 rule) because i18next
// suffix resolution needs Intl.PluralRules, which Hermes does not guarantee.
export function retentionLabel(seconds: number, t: TFunction): string {
  if (seconds <= 0) return t('retention.optionOff');
  const preset = RETENTION_PRESETS[seconds];
  if (preset) return t(preset);
  const unit =
    RETENTION_UNITS.find((u) => seconds % u.seconds === 0) ?? RETENTION_UNITS[RETENTION_UNITS.length - 1];
  const count = seconds / unit.seconds;
  return t(count === 1 ? unit.one : unit.other, { count });
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
  | 'screenshot.systemRequestIn'
  | 'screenshot.systemRequestInOff'
  | 'screenshot.systemRequestOut'
  | 'screenshot.systemRequestOutOff'
  | 'screenshot.systemChangedIn'
  | 'screenshot.systemChangedInOff'
  | 'screenshot.systemChangedOut'
  | 'screenshot.systemChangedOutOff'
  | 'screenshot.systemDeclinedIn'
  | 'screenshot.systemDeclinedOut'
  | 'screenshot.systemCanceledIn'
  | 'screenshot.systemCanceledOut'
  | 'call.rowOutgoing'
  | 'call.rowIncoming'
  | 'call.rowMissedIn'
  | 'call.rowMissedOut'
  | 'call.rowBusyOut'
  | 'call.rowCanceledOut'
  | 'call.rowDeclinedIn'
  | 'call.rowDeclinedOut'
  | 'call.rowFailed'
  | 'system.verified'
  | 'system.nameChanged'
  | 'system.identityChanged'
  | 'system.securityUpgrade';

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
    // Screenshot rows carry '1' or '0' in the body, so the shared `off` flag applies.
    case 'screenshot/request':
      if (incoming) return off ? 'screenshot.systemRequestInOff' : 'screenshot.systemRequestIn';
      return off ? 'screenshot.systemRequestOutOff' : 'screenshot.systemRequestOut';
    case 'screenshot/changed':
      if (incoming) return off ? 'screenshot.systemChangedInOff' : 'screenshot.systemChangedIn';
      return off ? 'screenshot.systemChangedOutOff' : 'screenshot.systemChangedOut';
    case 'screenshot/declined':
      return incoming ? 'screenshot.systemDeclinedIn' : 'screenshot.systemDeclinedOut';
    case 'screenshot/canceled':
      return incoming ? 'screenshot.systemCanceledIn' : 'screenshot.systemCanceledOut';
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
    case 'verified':
      return 'system.verified';
    case 'name/changed':
      return 'system.nameChanged';
    case 'identity/changed':
      return 'system.identityChanged';
    case 'security/upgrade':
      return 'system.securityUpgrade';
  }
}

// Interpolation values for a name change row. The body carries both names as JSON (see
// MessageKind in the messages repo), so the note stays correct after later renames. Empty
// string fallbacks keep the template rendering even for a malformed body, and non name
// kinds always get the fallbacks so callers can spread this unconditionally.
export function nameChangeParams(kind: MessageKind, body: string | null): { oldName: string; newName: string } {
  if (kind === 'name/changed' && body != null) {
    try {
      const parsed = JSON.parse(body) as { old?: unknown; new?: unknown };
      return {
        oldName: typeof parsed.old === 'string' ? parsed.old : '',
        newName: typeof parsed.new === 'string' ? parsed.new : '',
      };
    } catch {
      // Malformed body: fall through to the fallbacks.
    }
  }
  return { oldName: '', newName: '' };
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
