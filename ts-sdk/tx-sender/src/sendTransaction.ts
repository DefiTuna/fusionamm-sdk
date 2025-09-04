//
// Copyright (c) Cryptic Dot
//
// Modification based on Orca Whirlpools (https://github.com/orca-so/whirlpools),
// originally licensed under the Apache License, Version 2.0, prior to February 26, 2025.
//
// Modifications licensed under FusionAMM SDK Source-Available License v1.0
// See the LICENSE file in the project root for license information.
//

import type {
  Address,
  IInstruction,
  KeyPairSigner,
  FullySignedTransaction,
  Signature,
  Commitment,
  SolanaRpcApi,
  Rpc,
} from "@solana/kit";
import { assertTransactionIsFullySigned, getBase64EncodedWireTransaction, getBase58Decoder } from "@solana/kit";
import { DEFAULT_TRANSACTION_CONFIG, TransactionConfig } from "./config";
import { buildTransaction } from "./buildTransaction";

/**
 * Builds and sends a transaction with the given instructions, signers, and commitment level.
 *
 * @param {Rpc<SolanaRpcApi>} rpc - Solana Rpc client.
 * @param {IInstruction[]} instructions - Array of instructions to include in the transaction.
 * @param {KeyPairSigner} payer - The fee payer for the transaction.
 * @param {TransactionConfig} config - The transaction config.
 * @param {Address[]} [lookupTableAddresses] - Optional array of address lookup table addresses to use.
 * @param {Commitment} [commitment="confirmed"] - The commitment level for transaction confirmation.
 *
 * @returns {Promise<Signature>} A promise that resolves to the transaction signature.
 *
 * @throws {Error} If transaction building or sending fails.
 *
 * @example
 * ```ts
 * const signature = await sendTransaction(
 *   instructions,
 *   keypairSigner,
 *   DEFAULT_TRANSACTION_CONFIG,
 *   lookupTables,
 *   "finalized"
 * );
 * ```
 */
export async function sendTransaction(
  rpc: Rpc<SolanaRpcApi>,
  instructions: IInstruction[],
  payer: KeyPairSigner,
  config?: TransactionConfig,
  lookupTableAddresses?: Address[],
  commitment: Commitment = "confirmed",
) {
  const tx = await buildTransaction(
    rpc,
    config ?? DEFAULT_TRANSACTION_CONFIG,
    instructions,
    payer,
    lookupTableAddresses,
  );
  assertTransactionIsFullySigned(tx);
  return sendSignedTransaction(rpc, tx, commitment);
}

/**
 * Sends a signed transaction message to the Solana network with a specified commitment level.
 *
 * @param {Rpc<SolanaRpcApi>} rpc - Rpc client.
 * @param {FullySignedTransaction} transaction - The fully signed transaction to send.
 * @param {Commitment} [commitment="confirmed"] - The commitment level for transaction confirmation.
 *
 * @returns {Promise<Signature>} A promise that resolves to the transaction signature.
 *
 * @throws {Error} If transaction sending fails, the RPC connection fails, or the transaction expires.
 *
 * @example
 * ```ts
 * assertTransactionIsFullySigned(signedTransaction);
 *
 * const signature = await sendSignedTransaction(
 *   rpc,
 *   signedTransaction,
 *   "finalized"
 * );
 * ```
 */
export async function sendSignedTransaction(
  rpc: Rpc<SolanaRpcApi>,
  transaction: FullySignedTransaction,
  commitment: Commitment = "confirmed",
): Promise<Signature> {
  const txHash = getTxHash(transaction);
  const encodedTransaction = getBase64EncodedWireTransaction(transaction);

  // Simulate transaction first
  const simResult = await rpc
    .simulateTransaction(encodedTransaction, {
      encoding: "base64",
    })
    .send();

  if (simResult.value.err) {
    throw new Error(`Transaction simulation failed`, { cause: simResult.value });
  }

  const expiryTime = Date.now() + 60_000;

  while (Date.now() < expiryTime) {
    await rpc
      .sendTransaction(encodedTransaction, {
        maxRetries: BigInt(0),
        skipPreflight: true,
        encoding: "base64",
      })
      .send();

    const { value } = await rpc.getSignatureStatuses([txHash]).send();
    const status = value[0];
    if (status?.confirmationStatus === commitment) {
      if (status.err) {
        throw new Error(`Transaction failed`, { cause: status.err });
      }
      return txHash;
    }
  }

  throw new Error("Transaction expired");
}

function getTxHash(transaction: FullySignedTransaction) {
  const [signature] = Object.values(transaction.signatures);
  return getBase58Decoder().decode(signature!) as Signature;
}
