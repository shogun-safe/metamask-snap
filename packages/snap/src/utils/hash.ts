/* eslint-disable camelcase */
/* eslint-disable jsdoc/require-jsdoc */
import { keccak_256 } from '@noble/hashes/sha3';
import {
  bytesToHex as bytesToHexHash,
  hexToBytes as hexToBytesHash,
} from '@noble/hashes/utils';

export function rlpHexToKeccak256Hash(rlpHex: string): string {
  const normalized = rlpHex.startsWith('0x') ? rlpHex.slice(2) : rlpHex;
  const bytes = hexToBytesHash(normalized);
  const hashBytes = keccak_256(bytes);
  return bytesToHexHash(hashBytes);
}
