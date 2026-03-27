# Shogun Safe

Snap package for **Shogun Safe**. It runs inside MetaMask, talks to the Shogun Safe backend using `REQUESTS_URL`, and adds transaction insight, a home page UI, and JSON-RPC handlers so users can run safety checks and track approval flows from the wallet.

## Snap Description

**Shogun Safe** is a security-focused MetaMask Snap that helps users evaluate transaction risk before signing and monitor approval workflows from within the wallet.

The Snap provides:
- Account login and session management against the Shogun Safe backend.
- Real-time transaction insight checks (parse / whitelist / blacklist / LLM / policy / approval stages).
- Request-status refresh and approved-transaction follow-up flows.
- A Home page UI in MetaMask for login, 2FA handling, and account status display.

The Snap does **not** custody funds, does **not** execute arbitrary transactions by itself, and only sends data required for Shogun Safe risk analysis and workflow APIs.

## Permission Usage

This Snap requests the following permissions in `snap.manifest.json`:

- `snap_dialog`  
  Used to open a user-facing dialog when dapps invoke Snap RPC methods that require explicit user interaction (for example, login and confirmation-related flows).

- `endowment:rpc` (`dapps: true`, `snaps: false`)  
  Allows JSON-RPC entry points from dapps so they can call supported Snap methods (e.g., opening login UI, post-signed transaction reporting, and approved-transaction signing flows).  
  Calls from other Snaps are intentionally disabled.

- `endowment:transaction-insight` (`allowTransactionOrigin: true`)  
  Enables transaction insight UI before signing.  
  The Snap uses this to submit transaction data for risk checks and optionally display the originating site context for transparency.

- `endowment:network-access`  
  Required to call Shogun Safe backend APIs (authentication, transaction checks, status polling, and post-signed reporting) through `REQUESTS_URL`.

- `endowment:page-home`  
  Enables the Snap Home page in MetaMask, where users can log in, complete 2FA, review account state, and log out.

- `snap_manageState`  
  Stores minimal local Snap state (session tokens and temporary tx-hash/request-id mappings) needed for login continuity and approval-linked transaction insight flows.

No permission is used for hidden background actions beyond the user-visible and API-integrated behaviors listed above.

## Development server

From this directory (`packages/metamask/packages/snap`):

```bash
yarn start
```

This runs `mm-snap watch`, which rebuilds when sources change and serves the snap for local testing. The dev server listens on **port 8080** by default (see `snap.config.ts`).

Optional: point the snap at a specific API base URL:

```bash
REQUESTS_URL='https://api.example.com' yarn start
```

To serve an already-built bundle without watch mode:

```bash
yarn serve
```

## Build

```bash
yarn build
```

Produces `dist/bundle.js` and updates the manifest as needed (`mm-snap build`).

Clean rebuild:

```bash
yarn build:clean
```

**Environment:** `REQUESTS_URL` is injected at build time via `snap.config.ts` (default `https://api.localhost`). Set it when building for a target environment, for example:

```bash
REQUESTS_URL='<Shogun Safe backend URL>' yarn build
```

## Tests

```bash
yarn test
```
