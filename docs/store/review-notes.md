# App Review notes (paste into App Store Connect, App Review Information)

These notes explain how to review a messenger whose contact exchange is strictly in
person, plus the reasons for the background modes and the registration gating. Replace
https://www.youtube.com/watch?v=lRs9VdbApJU before submitting.

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
   by side. We recorded the complete flow on two phones here: https://www.youtube.com/watch?v=lRs9VdbApJU
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

User generated content precautions (Guideline 1.2), added in build 11 after the July 15,
2026 rejection:

- Terms of use: onboarding requires an explicit agreement (checkbox plus link) to the
  hosted terms at https://nuco-messenger.com/terms BEFORE an account can be created. The
  terms state zero tolerance for objectionable content and abusive users.
- Filtering: unsolicited content is structurally impossible in Nuco. A conversation only
  exists after two people scanned each other's QR code IN PERSON and both confirmed the
  matching emoji code; messages from anyone else are dropped before display. There are no
  public feeds, no discovery, no group content, and strangers cannot contact a user.
- Flagging: every contact can be reported from the contact screen ("Report contact"), and
  every received message via long press ("Report"). The report reaches our server
  operator with a category and optional note. Because all messages are end to end
  encrypted (Signal Protocol), a report contains no message content; it identifies the
  abusive account.
- Blocking: every contact can be blocked instantly from the contact screen (and directly
  from the report sheet via "Also block"); blocking stops all delivery from that account
  immediately on the device. The developer is notified through the same report mechanism.
- 24 hour action: we review reports within 24 hours and eject offenders by suspending
  their account on the relay (a suspended account cannot connect, send, or re-register).
  Since content is end to end encrypted and stored only on user devices, "removing the
  content" takes the form of removing the offender's access; the reporting user deletes
  the conversation locally (delete chat and delete for me exist in the app).

The demo recording covering the terms agreement in onboarding, the report flow, and the
block flow (captured on a physical iPhone) is linked in this submission's review notes.

## Assets to prepare before submission

- The two device demo video (record during the TestFlight device pass, English UI,
  covering onboarding, mutual scan, emoji verification, messaging, a disappearing message
  expiring, a voice call, and the lock screen). Upload anywhere reviewers can stream
  without login (for example an unlisted Vimeo or a direct HTTPS mp4) and replace
  https://www.youtube.com/watch?v=lRs9VdbApJU above.
- Contact fields in App Review Information: a reachable phone number and
  support@zlsoftware.at.
- A physical device screen recording for Guideline 1.2 (single iPhone is enough) showing:
  the terms checkbox and link on the onboarding welcome screen (tap the link so the terms
  page opens, then agree and continue), the report sheet from a contact's detail page and
  from a message long press (send one report), and the block toggle plus the "Also block"
  toggle inside the report sheet. Host it like the demo video and link it in the review
  notes; Apple asked for exactly these three flows in the rejection of build 10.
