import { describe, it, expect, beforeAll } from 'vitest';
import './setup';
import { getServerWallet, getServerAddress, signPayload, verifySignature } from '../src/services/crypto';

describe('crypto service', () => {
  beforeAll(() => {
    // setup.ts sets SERVER_ETH_PRIVATE_KEY
  });

  describe('getServerWallet', () => {
    it('returns an ethers Wallet instance', () => {
      const wallet = getServerWallet();
      expect(wallet).toBeDefined();
      expect(wallet.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
    });

    it('returns the same wallet on subsequent calls', () => {
      const w1 = getServerWallet();
      const w2 = getServerWallet();
      expect(w1).toBe(w2);
    });
  });

  describe('getServerAddress', () => {
    it('returns a valid Ethereum address', () => {
      const addr = getServerAddress();
      expect(addr).toMatch(/^0x[a-fA-F0-9]{40}$/);
    });
  });

  describe('signPayload', () => {
    it('signs a message and returns a hex string', async () => {
      const sig = await signPayload('test message');
      expect(sig).toMatch(/^0x/);
      expect(sig.length).toBeGreaterThan(10);
    });

    it('produces different signatures for different messages', async () => {
      const sig1 = await signPayload('message 1');
      const sig2 = await signPayload('message 2');
      expect(sig1).not.toBe(sig2);
    });
  });

  describe('verifySignature', () => {
    it('verifies a valid signature', async () => {
      const msg = 'hello world';
      const sig = await signPayload(msg);
      const addr = getServerAddress();
      expect(verifySignature(msg, sig, addr)).toBe(true);
    });

    it('rejects signature with wrong address', async () => {
      const msg = 'test';
      const sig = await signPayload(msg);
      expect(verifySignature(msg, sig, '0x0000000000000000000000000000000000000000')).toBe(false);
    });

    it('rejects invalid signature', () => {
      expect(verifySignature('test', 'not-a-signature', getServerAddress())).toBe(false);
    });

    it('is case-insensitive for addresses', async () => {
      const msg = 'case test';
      const sig = await signPayload(msg);
      const addr = getServerAddress();
      expect(verifySignature(msg, sig, addr.toLowerCase())).toBe(true);
      expect(verifySignature(msg, sig, addr.toUpperCase())).toBe(true);
    });
  });
});
