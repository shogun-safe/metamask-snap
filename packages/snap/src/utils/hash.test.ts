/* eslint-disable prettier/prettier */
/* eslint-disable require-unicode-regexp */
import { rlpHexToKeccak256Hash } from './hash';

describe('rlpHexToKeccak256Hash', () => {
  it('returns 64-character hex string (no 0x prefix)', () => {
    const rlpHex = '0x02f8';
    const hash = rlpHexToKeccak256Hash(rlpHex);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toMatch(/^0x/);
  });

  it('same input produces same hash', () => {
    const rlpHex = '0x02f86c808504a817c80082520894adf3b878ebb0b31a64c279d50c4f0c0e3c69e7e0880de0b6b3a764000080c0';
    expect(rlpHexToKeccak256Hash(rlpHex)).toBe(rlpHexToKeccak256Hash(rlpHex));
  });

  it('accepts hex without 0x prefix', () => {
    const withPrefix = '0x02f8';
    const withoutPrefix = '02f8';
    expect(rlpHexToKeccak256Hash(withPrefix)).toBe(rlpHexToKeccak256Hash(withoutPrefix));
  });

  it('different inputs produce different hashes', () => {
    const hash1 = rlpHexToKeccak256Hash('0x01');
    const hash2 = rlpHexToKeccak256Hash('0x02');
    expect(hash1).not.toBe(hash2);
  });
});
