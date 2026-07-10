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

The app config declares `usesNonExemptEncryption: false`. Rationale, learned the hard way
(delivery rejection ITMS-90592): in Apple's current flow, export compliance DOCUMENTATION
(and the `ITSEncryptionExportComplianceCode` that goes with it) exists only for two cases,
proprietary or non standard cryptography, or standard cryptography distributed in France.
The App Store Connect API literally refuses to create a declaration otherwise. Nuco
implements only standard algorithms (Signal Protocol via libsignal: AES, Curve25519,
HMAC, and since protocol 3.0 ML-KEM-1024, the NIST FIPS 203 standard, for PQXDH) and v1
excludes France from availability, so no documentation requirement applies, which is
exactly Apple's definition of the `false` value ("only uses forms of encryption that are
exempt from export compliance documentation requirements"). A build declaring `true`
without a matching code is rejected at delivery.

Remaining obligations:

- United States: file the annual self classification report to BIS and the NSA (an email
  with the app's classification, ECCN 5D992.c mass market) by February 1 each year.
- France: excluded from v1 availability. To add France later: file the ANSSI declaration,
  then create the encryption declaration in App Store Connect (standard cryptography plus
  available on the French store), receive the compliance code, set
  `usesNonExemptEncryption: true` plus `ITSEncryptionExportComplianceCode` in app.json,
  and rebuild before flipping the territory on.

This is not legal advice. Confirm the current BIS and ANSSI requirements before filing.
