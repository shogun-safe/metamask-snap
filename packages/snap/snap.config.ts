import type { SnapConfig } from '@metamask/snaps-cli';
import { resolve } from 'path';

/**
 * MetaMask Snaps CLI build configuration: entry bundle, dev server, env, and polyfills.
 */
const config: SnapConfig = {
  input: resolve(__dirname, 'src/index.tsx'),
  server: {
    port: 8080,
  },
  environment: {
    REQUESTS_URL: process.env.REQUESTS_URL ?? 'https://api.localhost',
  },
  polyfills: {
    buffer: true,
  },
};

export default config;
