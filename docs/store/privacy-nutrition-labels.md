# Apple App Privacy answers and encryption export compliance

Draft answers for App Store Connect. Confirm against the current questionnaire wording, which
Apple changes periodically. The guiding fact: the relay only ever handles opaque identifiers
and unreadable ciphertext, and there are no analytics or tracking SDKs in the app.

## App Privacy questionnaire (App Store Connect, App Privacy section)

Overall: the app collects a very small set of identifiers needed to route messages, uses them
only for app functionality, does not link them to the user's real identity, and does not use
them for tracking.

Declare these data types as collected:

- Identifiers, User ID: the random account handle. Purpose: App Functionality. Linked to the
  user's identity: No. Used for tracking: No. (The handle is random and not derived from name,
  email, or phone number.)
- Identifiers, Device ID: the push token, only if the user enables notifications. Purpose: App
  Functionality. Linked to identity: No. Used for tracking: No.

Declare NOT collected:

- Contacts: the app never uploads your address book or contact list. Contacts are added by
  scanning a code in person and stored only on device.
- Messages / User Content: messages are end to end encrypted; the provider cannot read them and
  does not retain readable content. Ciphertext is transient routing data, held only until
  delivery and then deleted (and in any case within 30 days). If App Review asks, explain the
  E2EE model: the relay stores only ciphertext it cannot decrypt.
- Location, Contacts, Health, Financial, Browsing History, Search History, Purchases,
  Diagnostics, Usage Data, Advertising Data: none collected. No analytics or ad SDKs are present.

Tracking: the app does NOT track users across apps or websites owned by other companies. No
`App Tracking Transparency` prompt is needed because nothing is used for tracking.

## Encryption export compliance

The app config now declares `usesNonExemptEncryption: true` (Nuco implements the Signal
Protocol, which is more than the exempt HTTPS category). At submission App Store Connect asks a
short export compliance flow. Draft answers:

- Does your app use encryption? Yes.
- Does your app qualify for any of the exemptions in Category 5, Part 2? Yes. Nuco uses standard
  cryptographic algorithms and is a mass market app, so it qualifies for the exemption under
  ECCN 5D992.c.
- Consequences and required filings:
  - United States: file the annual self classification report to BIS and the NSA (an email with
    the app's classification) as required for 5D992.c mass market products.
  - France: because the app is available in France, submit the encryption declaration to ANSSI
    for a mass market product using cryptography.
  - Keep a copy of these filings; App Store Connect may let you store an
    `ITSEncryptionExportComplianceCode` afterward so future builds skip the questionnaire.

This is not legal advice. Confirm the current BIS and ANSSI requirements before filing.
