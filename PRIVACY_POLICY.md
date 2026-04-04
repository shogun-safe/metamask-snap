# Shogun Safe Snap Privacy Policy

Effective date: March 19, 2026

This Privacy Policy applies specifically to the **Shogun Safe MetaMask Snap** (the "Snap").
It supplements the general Shogun Safe privacy policy and explains what information may be processed through the Snap, why it is used, how it is handled, and what rights users may have.

The Snap is designed to provide transaction insight, login-related account functions, and approval workflow support inside MetaMask.

## 1. Scope

This policy applies to information processed through the Snap when a user:

- opens the Snap Home page in MetaMask;
- logs in to Shogun Safe through the Snap;
- completes 2FA or recovery-code verification through the Snap;
- requests transaction insight checks before signing;
- refreshes request status or reports a signed transaction through Snap-supported flows.

This policy does not replace the broader Shogun Safe privacy policy that applies to the Shogun Safe service, website, dashboard, and related backend systems.

## 2. Information Processed by the Snap

To provide Snap functionality, we may process the following categories of information:

- Account and authentication information, such as email address, password, temporary authentication tokens, access tokens, refresh tokens, 2FA status, one-time authentication codes, and recovery codes.
- Basic account display information returned by the Shogun Safe backend, such as email address and display name.
- Transaction-related information, such as wallet address, network or chain identifier, destination address, transaction value, raw transaction data, serialized transaction data, transaction hash, request ID, and transaction-origin information.
- Operational and diagnostic information necessary to render Snap UI and troubleshoot API responses, such as request status, check results, and limited debug text.

The Snap is not designed to collect or store a user’s Secret Recovery Phrase, private keys, or seed phrases.
The Snap also does not independently execute arbitrary fund transfers or use collected information for advertising purposes.

## 3. Local State Stored in MetaMask

The Snap uses `snap_manageState` to store a limited amount of local state inside the user’s MetaMask environment.

This local state may include:

- session-related data such as access tokens, refresh tokens, and basic user display information; and
- temporary mappings between transaction hashes and Shogun Safe request IDs used to connect approval-related flows.

Transaction hash and request ID mappings are intended to be temporary and may be removed after the associated approval-linked flow is completed.
Session-related data may remain in MetaMask until the user logs out, the session is replaced, or the state is otherwise cleared.

The Snap does not use this local state to sell data, profile users for advertising, or perform unrelated tracking.

## 4. Purposes of Use

Information processed through the Snap may be used for the following purposes:

- to authenticate users and maintain Snap login continuity;
- to support 2FA verification and account protection;
- to submit transaction data to Shogun Safe for risk analysis and approval workflow processing;
- to display transaction insight results and approval status inside MetaMask;
- to refresh request state and associate signed transactions with existing Shogun Safe requests;
- to respond to incidents, improve security, preserve auditability, and troubleshoot service issues;
- to comply with law, regulation, and protect rights and legitimate interests.

## 5. Network Requests and Backend Processing

The Snap uses network access to communicate with the Shogun Safe backend configured by `REQUESTS_URL`.

Depending on the user action, the Snap may send information to backend endpoints for:

- login and logout;
- token refresh;
- 2FA status lookup and verification;
- transaction insight submission;
- request check start and polling;
- approved request lookup; and
- post-signed transaction reporting.

Information sent through these requests is limited to what is reasonably necessary to provide the corresponding feature.
For example, the Snap may send email address and password for login, temporary tokens and 2FA or recovery codes for authentication, raw transaction data and wallet-related metadata for transaction insight, request IDs for status lookup, transaction hashes for post-signed reporting, and transaction-origin information where available for transparency and risk-review purposes.

## 6. Third-Party Sharing and Service Providers

We do not provide personal information processed through the Snap to third parties without the user’s consent except where permitted or required by law or otherwise justified.

However, to operate the Shogun Safe service and Snap-related backend functions, we may use cloud infrastructure, authentication tools, logging systems, analytics tools, email delivery providers, and other service providers.
Where such providers handle information on our behalf, we supervise them appropriately.

## 7. Cross-Border Transfers

We may use infrastructure or service providers located outside the user’s country or region where necessary to operate the Snap and the related Shogun Safe service.
In such cases, we handle information in accordance with applicable law and implement appropriate safeguards.

## 8. Security Measures

We implement reasonable and appropriate safeguards to protect information processed through the Snap against unauthorized access, leakage, loss, misuse, or alteration.

These measures may include access controls, token handling, backend authentication controls, and operational monitoring.
However, internet-based systems and wallet environments involve inherent risks, and absolute security cannot be guaranteed.

## 9. Retention

We retain information processed through the Snap only for as long as necessary for:

- providing the Snap and related Shogun Safe services;
- security, audit, and dispute-resolution needs;
- contractual requirements; or
- compliance with applicable law.

Information that is no longer needed is deleted, anonymized, or otherwise handled using reasonable methods.

## 10. Cookies and Similar Technologies

The Snap itself does not rely on browser cookies in the same way a standard website does.
However, related Shogun Safe web properties or backend-connected services may use cookies or similar technologies as described in the broader Shogun Safe privacy policy.

## 11. User Rights

Subject to applicable law, users may request access, correction, deletion, restriction of use, or other actions regarding personal information processed in connection with the Snap.
Request methods and conditions are subject to applicable legal requirements and our designated procedures.
Requests may be submitted through the contact channel listed in the Contact section below.

## 12. Changes to This Policy

We may update this Privacy Policy to reflect legal changes, operational needs, or changes to the Snap or related Shogun Safe services.
The revised policy will apply when posted in the repository, distributed by another method we consider appropriate, or on a separately specified effective date.

## 13. Contact

For questions about this Privacy Policy or requests relating to privacy rights, please contact Shogun Safe through one of the following channels:

- Privacy contact email: `privacy@example.com`
- Support page or inquiry form: `https://example.com/support`

These values are placeholders and should be replaced with the official contact details before publication or submission.
