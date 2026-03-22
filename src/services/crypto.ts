import { ethers } from "ethers";
import { getRequiredEnv } from "../lib/env-helper.ts";

let serverWallet: ethers.Wallet | null = null;

/** Get the server's Ethereum wallet */
export function getServerWallet(): ethers.Wallet {
  if (!serverWallet) {
    const privateKey = getRequiredEnv("SERVER_ETH_PRIVATE_KEY");
    serverWallet = new ethers.Wallet(privateKey);
  }
  return serverWallet;
}

/** Get the server's Ethereum wallet address */
export function getServerAddress(): string {
  return getServerWallet().address;
}

/**
 * Sign a payload with the server's ETH key.
 * Returns the signature as a hex string.
 */
export async function signPayload(payload: string): Promise<string> {
  const wallet = getServerWallet();
  return wallet.signMessage(payload);
}

/**
 * Verify a message was signed by a specific Ethereum address.
 * Returns true if the recovered address matches.
 */
export function verifySignature(
  message: string,
  signature: string,
  expectedAddress: string
): boolean {
  try {
    const sig = signature.startsWith("0x") ? signature : `0x${signature}`;
    const recovered = ethers.verifyMessage(message, sig);
    console.log("[crypto] verifySignature", { recovered, expectedAddress, match: recovered.toLowerCase() === expectedAddress.toLowerCase() });
    return recovered.toLowerCase() === expectedAddress.toLowerCase();
  } catch (e) {
    console.log("[crypto] verifySignature error:", e);
    return false;
  }
}
