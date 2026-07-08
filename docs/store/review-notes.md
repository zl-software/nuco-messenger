# App Review notes (paste into App Store Connect, App Review Information)

These notes explain how to review a messenger whose contact exchange is strictly in
person, plus the reasons for the background modes and the registration gating. Replace
REPLACE_WITH_VIDEO_URL before submitting.

## Suggested review notes text

Nuco is an end to end encrypted 1:1 messenger with a deliberately unusual contact model:
there are NO user accounts, NO logins, and NO server side contact discovery. A contact can
only be added by two people physically scanning each other's QR code, and a conversation
only unlocks after both people confirm a matching emoji code on both screens (in person
verification against man in the middle attacks).

Because of this there is no demo account we can provide: an account is just a key pair
generated on the device during onboarding, and pairing requires two devices in the same
room.

How to review:

1. Onboarding, lock, and settings can be fully exercised on one device. Launch the app,
   complete onboarding (a key pair and a random handle are generated locally; no phone
   number, email, or personal data is requested), set the PIN, and explore.
2. The full messaging flow (mutual QR scan, emoji verification, sealed messaging,
   disappearing messages, a voice call, screenshot protection) requires two devices side
   by side. We recorded the complete flow on two phones here: REPLACE_WITH_VIDEO_URL
3. If you have two test devices available, the whole pairing flow takes about a minute:
   both devices show their QR under "Add contact", each scans the other, then both
   confirm the emoji match.

Technical notes for the reviewer:

- Background mode "audio": used only during active 1:1 voice calls (WebRTC). There is no
  other background audio.
- Background mode "remote-notification": message notifications. Push payloads are content
  free by design (a generic localized "New message" banner); the message text and sender
  never pass through APNs.
- DeviceCheck App Attest: the app attests new account registrations to our relay server
  so only genuine App Store builds can create accounts on it. This is transparent during
  review; production signed builds attest successfully.
- Encryption: the app uses the Signal Protocol for end to end encryption; export
  compliance answers are provided in App Store Connect (mass market, ECCN 5D992.c).
- The app is paid up front with no in app purchases, no subscriptions, no ads, and no
  analytics or tracking SDKs. There is no account deletion requirement beyond what the
  app already offers (Settings, Delete account, removes all server side data).
- A user can point the app at a self hosted relay in Settings (the relay is open source);
  the default server requires no configuration.

## Assets to prepare before submission

- The two device demo video (record during the TestFlight device pass, English UI,
  covering onboarding, mutual scan, emoji verification, messaging, a disappearing message
  expiring, a voice call, and the lock screen). Upload anywhere reviewers can stream
  without login (for example an unlisted Vimeo or a direct HTTPS mp4) and replace
  REPLACE_WITH_VIDEO_URL above.
- Contact fields in App Review Information: a reachable phone number and
  support@zlsoftware.at.
