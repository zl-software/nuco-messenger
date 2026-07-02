# Nuco Privacy Policy

Last updated: REPLACE_WITH_DATE

Nuco is an end to end encrypted messenger. It is built so that we cannot read your messages,
and so that we collect as little as possible about you. This policy explains exactly what the
app and its relay server do and do not handle.

## The short version

- Your messages are end to end encrypted with the Signal Protocol. They are sealed on your
  device and can only be read on your device and your contact's device.
- We never see the content of your messages, your contact list, or your display name.
- We do not use any analytics, advertising, or tracking SDKs. There are no third party trackers.
- Your message history lives only on your device, inside an encrypted database. There is no
  cloud backup. If you lose your device, that history is gone.
- You can delete your account and all of its server side data from inside the app at any time.

## What the app stores on your device

Everything that identifies you or your conversations is kept locally in an encrypted database
protected by a key that is released only after you unlock the app with your PIN or biometrics:

- your identity keys and the keys for each conversation,
- your contacts (added by scanning a code in person),
- your messages and their disappearing message timers.

None of this is uploaded to us.

## What the relay server handles

To deliver messages between two devices, our relay server handles the minimum required:

- a random account handle that is not derived from your name, email, or phone number,
- your public keys (used by your contacts to start an encrypted session with you),
- for each queued message: the encrypted, unreadable ciphertext and routing metadata (which
  handle it is for, and roughly when), held only until your device fetches it and then deleted,
  and in any case removed after 30 days,
- if you enable notifications: an opaque push token or endpoint used only to wake your device.

The relay never receives your message content, your display name, or your contacts. It cannot
decrypt anything. We do not sell, rent, or share any of this data.

## Notifications

Push notifications are content free. A notification tells your device to connect and fetch
new messages; it never carries message text or the sender's identity through the push
provider (Apple). If you turn on message previews in Settings, previews are produced on your
device after decryption, never by us.

## Camera

The app uses the camera only to scan a contact's code when you choose to add a contact. No
photos or video are stored or transmitted.

## Children

Nuco is not directed at children under 13.

## Account deletion

You can delete your account at any time from Settings, Delete account. This removes your
handle, public keys, and any queued messages from the relay, and erases all keys and messages
on your device. It cannot be undone.

## Changes

If this policy changes, we will update the date above and post the new version at this URL.

## Contact

Questions about this policy: REPLACE_WITH_SUPPORT_EMAIL
