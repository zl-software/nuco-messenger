// The call button flow: pre flight mic permission with the same soft ask pattern as the
// camera in add-contact (explain first, then the OS prompt), then availability guards,
// then hand off to the controller. Unavailability surfaces as a plain alert, matching the
// confirm dialogs in settings.

import { useCallback } from 'react';
import { Alert } from 'react-native';
import { useMicrophonePermissions } from 'expo-camera';
import { useTranslation } from 'react-i18next';

import { getCallController } from '@/services/calls';
import { useCall } from '@/state/call';
import type { CallAvailability, CallTarget } from './types';

type UnavailableKey = 'call.errorBusy' | 'call.errorBlocked' | 'call.errorOffline' | 'call.errorNoSession';

function unavailableKey(availability: Exclude<CallAvailability, 'ok'>): UnavailableKey {
  switch (availability) {
    case 'busy':
      return 'call.errorBusy';
    case 'blocked':
      return 'call.errorBlocked';
    case 'offline':
      return 'call.errorOffline';
    case 'no-session':
      return 'call.errorNoSession';
  }
}

type TranslateFn = (key: UnavailableKey | 'call.unavailableTitle', opts?: { name: string }) => string;

// Availability guard plus place. Shared by the call buttons (mic already granted) and the
// soft ask sheet in CallHost (mic granted a moment ago).
export async function beginCall(contact: CallTarget, t: TranslateFn): Promise<void> {
  const outcome = await getCallController().placeCall(contact);
  if (outcome !== 'ok') {
    Alert.alert(t('call.unavailableTitle'), t(unavailableKey(outcome), { name: contact.displayName }));
  }
}

export function useStartCall(): (contact: CallTarget) => Promise<void> {
  const [micPermission, requestMicPermission] = useMicrophonePermissions();
  const { t } = useTranslation();
  const setMicPrompt = useCall((s) => s.setMicPrompt);

  return useCallback(
    async (contact: CallTarget) => {
      if (micPermission?.granted) {
        await beginCall(contact, t);
        return;
      }
      if (micPermission && !micPermission.canAskAgain) {
        Alert.alert(t('call.micDeniedTitle'), t('call.micDeniedBody'));
        return;
      }
      // Soft ask first: CallHost renders the sheet and resumes the call after the OS
      // prompt is granted.
      setMicPrompt({ contact });
    },
    [micPermission, t, setMicPrompt],
  );
}
