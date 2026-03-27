# Shogun Safe

Snap package for **Shogun Safe**. It runs inside MetaMask, talks to the Shogun Safe backend using `REQUESTS_URL`, and adds transaction insight, a home page UI, and JSON-RPC handlers so users can run safety checks and track approval flows from the wallet.

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
