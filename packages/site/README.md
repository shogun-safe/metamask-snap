# Test site Package

This package is the Gatsby frontend used to connect to MetaMask Flask and install/invoke the Snap.

## Prerequisites

- Node.js `>=18.6.0`
- Yarn `3.2.1`
- Dependencies installed from the workspace root (`packages/metamask`)

## Setup

From `packages/metamask`:

```bash
yarn install
```

## Start the Site

From `packages/metamask`:

```bash
yarn workspace site start
```

Or from this directory (`packages/metamask/packages/site`):

```bash
yarn start
```

## Build

```bash
yarn workspace site build
```
