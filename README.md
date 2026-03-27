# Shogun Safe MetaMask Snap Workspace Setup

This workspace contains Shogun Safe Snap package and the test site package used to run and test the MetaMask integration.

## Prerequisites

- Node.js `>=18.6.0` (recommended: version from `.nvmrc`, currently `lts/*`)
- Yarn `3.2.1` (managed by Corepack)
- MetaMask Flask (for local Snap development)

## Setup

From `packages/metamask`:

```bash
corepack enable
yarn install
```

## Run in Development

### 1) Start Snap watcher

```bash
yarn workspace @shogun-safe/metamask-snap start
```

### 2) Start Site app

Open another terminal in `packages/metamask` and run:

```bash
yarn workspace site start
```

The site runs with Gatsby dev server and can be used to connect/install the local Snap in MetaMask Flask.

## Useful Commands

- Run all workspaces: `yarn start`
- Build all workspaces: `yarn build`
- Test Snap: `yarn workspace @shogun-safe/metamask-snap test`
- Lint all workspaces: `yarn lint`
