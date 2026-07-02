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
  | 'retention.systemCanceledOut';

// The i18n key for a system message row. The caller interpolates { name, value }. Turning
// the timer off has dedicated keys so the copy never reads "disappear after Off".
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
  }
}
