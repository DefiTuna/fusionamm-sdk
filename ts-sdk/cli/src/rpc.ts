import { configDotenv } from "dotenv";
import { createKeyPairSignerFromBytes, createSolanaRpc, KeyPairSigner } from "@solana/kit";
import fs from "fs";
import path from "path";
import os from "os";

async function loadKeypair(): Promise<KeyPairSigner> {
  try {
    const keypairFile = fs.readFileSync(path.join(os.homedir(), ".config", "solana", "id.json"));
    const keypairBytes = new Uint8Array(JSON.parse(keypairFile.toString()));
    return await createKeyPairSignerFromBytes(keypairBytes);
  } catch (error: unknown) {
    throw new Error("Failed to load keypair: " + error);
  }
}

configDotenv({ path: "./.env" });

const RPC_URL = process.env.RPC_URL || "https://api.mainnet-beta.solana.com";

export const rpc = createSolanaRpc(RPC_URL);
export const signer = await loadKeypair();
