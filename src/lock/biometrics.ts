// Biometric and device credential checks via expo-local-authentication. Authentication
// here only returns success or failure; the actual decryption gate is releasing the
// database key (see secure-storage and lock-controller), so a successful prompt is never
// cosmetic.

import * as LocalAuthentication from 'expo-local-authentication';

export async function biometricsAvailable(): Promise<boolean> {
  const [hasHardware, isEnrolled] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
  ]);
  return hasHardware && isEnrolled;
}

export async function isStrongBiometric(): Promise<boolean> {
  const level = await LocalAuthentication.getEnrolledLevelAsync();
  return level === LocalAuthentication.SecurityLevel.BIOMETRIC_STRONG;
}

export async function promptBiometrics(promptMessage: string, cancelLabel: string): Promise<boolean> {
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage,
    cancelLabel,
    // Leave the OS device credential (PIN / passcode) fallback enabled so users without
    // biometrics can still authenticate at the OS layer.
    disableDeviceFallback: false,
  });
  return result.success;
}
