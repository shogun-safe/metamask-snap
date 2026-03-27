import { keccak_256 } from '@noble/hashes/sha3';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

/**
 * Computes the Keccak-256 hash of RLP/hex input and returns a lowercase hex string (no `0x` prefix).
 * Used as the state key for the tx hash ↔ request id mapping.
 * @param rlpHex - RLP-encoded transaction as a hex string, with or without a `0x` prefix.
 * @returns 64-character lowercase hex digest (no `0x` prefix).
 */
export function rlpHexToKeccak256Hash(rlpHex: string): string {
  const normalized = rlpHex.startsWith('0x') ? rlpHex.slice(2) : rlpHex;
  const bytes = hexToBytes(normalized);
  const hashBytes = keccak_256(bytes);
  return bytesToHex(hashBytes);
}
