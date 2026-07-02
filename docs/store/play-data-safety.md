# Google Play Data Safety answers (Android, later track)

Draft answers for the Play Console Data Safety form. Same underlying facts as the Apple
questionnaire: the relay handles only opaque identifiers and unreadable ciphertext, and there
are no analytics or tracking SDKs.

## Data collection and sharing

- Does your app collect or share any of the required user data types? Yes, a minimal set.
- Is all of the user data encrypted in transit? Yes (TLS to the relay, plus end to end
  encryption of message content on top).
- Do you provide a way for users to request that their data is deleted? Yes, in app account
  deletion (Settings, Delete account) removes the server side account and wipes local data.

## Data types

Collected and sent off device:

- Device or other IDs: a random account handle, and a push token if notifications are enabled.
  Collected: Yes. Shared: No. Purpose: App functionality (message delivery). Not linked to a
  real world identity. Not used for tracking or advertising.

Not collected:

- Messages / other in app content: end to end encrypted; the relay only stores unreadable
  ciphertext transiently for delivery, so no readable content is collected.
- Contacts: never uploaded. Added by scanning a code in person, stored on device only.
- Location, personal info (name, email, phone), financial info, photos, audio, calendar,
  app activity / analytics, crash logs: none collected. No analytics or ad SDKs are present.

## Permissions to justify in the listing

- CAMERA: only to scan a contact's code when adding a contact.
- POST_NOTIFICATIONS: to show local notifications after a content free wake.
- USE_BIOMETRIC: to unlock the app.
- FOREGROUND_SERVICE / FOREGROUND_SERVICE_DATA_SYNC: to hold the message connection when the
  app is running in the background (Android delivery fallback).

Note: the app requests no microphone, location, or contacts permissions.
