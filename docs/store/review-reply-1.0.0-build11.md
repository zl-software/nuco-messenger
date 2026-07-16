# Reply to the July 15, 2026 rejection (submission ce0618a5, v1.0.0 build 10)

Paste into the App Store Connect resolution center thread when resubmitting with
build 11. Replace the RECORDING_URL placeholder first (the 1.2 demo recording, see
review-notes.md "Assets to prepare").

## Suggested reply text

Hello,

Thank you for the detailed review. We have addressed both issues.

Guideline 5 (CallKit in China): We have removed mainland China from the app's
availability in App Store Connect. The app is no longer offered on the China App
Store, so CallKit functionality is not available there. Hong Kong, Macau, and Taiwan
remain available.

Guideline 1.2 (User-generated content): Build 11 implements the required precautions.

- Terms of use: Before an account can be created, onboarding now requires an explicit
  agreement to our Terms of Use (checkbox plus a link that opens
  https://nuco-messenger.com/terms). The terms state zero tolerance for objectionable
  content and abusive users, and describe reporting, blocking, and enforcement.
- Filtering of objectionable content: Unsolicited content is structurally impossible in
  Nuco. There are no public feeds, no groups, and no user discovery. A conversation only
  exists after two people scan each other's QR code in person and both confirm a matching
  verification code; messages from anyone else are dropped before they are ever shown.
  A user can never receive content from a stranger.
- Flagging: Users can report any contact ("Report contact" on the contact screen) and any
  received message (long press, "Report"). Reports reach us with a category and an
  optional note. Because all messages are end to end encrypted, reports identify the
  abusive account rather than carrying message content.
- Blocking: Users can block any contact instantly from the contact screen, and the report
  sheet includes a preselected "Also block" option, so reporting notifies us and removes
  the abuser in one step. Blocking takes effect immediately on the device, and users can
  delete the conversation content locally at any time.
- Developer action within 24 hours: We review every report within 24 hours and eject
  offenders by suspending their account on our server. A suspended account can no longer
  connect, send messages, or re-register. This commitment is published in our Terms of
  Use.

A screen recording captured on a physical iPhone demonstrating (1) the terms agreement
during onboarding, (2) the report flow on a contact and on a message, and (3) the block
mechanism is available here: RECORDING_URL. It is also referenced in the App Review
notes.

Thank you,
ZL Software

## Submission checklist for build 11

1. Deploy the 3.2 relay to production and set the ADMIN_TOKEN secret (see the ship
   commands in the session summary / server README).
2. Deploy the website (terms pages must be live BEFORE review: the onboarding link and
   the reply reference https://nuco-messenger.com/terms).
3. Remove mainland China from availability (apple/remove-china.mjs, or ASC UI:
   Distribution -> Pricing and Availability). Verify Mac (Designed for iPhone) and
   Apple Vision Pro availability are off while there (App Attest cannot register on
   those targets).
4. Build: `eas build --profile production --platform ios` (autoIncrement makes it
   build 11).
5. Record the 1.2 demo on a physical device (terms gate, report contact, report message,
   block toggle plus "Also block"), host it, replace RECORDING_URL above and add the link
   to the App Review notes in ASC.
6. Update the App Review notes in ASC with the UGC precautions section from
   review-notes.md.
7. Submit build 11 on version 1.0.0, then post the reply above in the resolution center.
