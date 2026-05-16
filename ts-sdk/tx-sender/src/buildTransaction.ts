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
  FullySignedTransaction,
  IInstruction,
  Rpc,
  SolanaRpcApi,
  TransactionSigner,
  TransactionWithLifetime,
} from "@solana/kit";
import {
  appendTransactionMessageInstructions,
  assertAccountDecoded,
  compressTransactionMessageUsingAddressLookupTables,
  createNoopSigner,
  createTransactionMessage,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from "@solana/kit";
import { fetchAllMaybeAddressLookupTable } from "@solana-program/address-lookup-table";

import { TransactionConfig } from "./config";
import { addPriorityInstructions } from "./priorityFees";

/**
 * Builds and signs a transaction from the given instructions and configuration.
 *
 * @param {Rpc<SolanaRpcApi>} rpc - Solana Rpc client.
 * @param {TransactionConfig} config - The transaction config.
 * @param {IInstruction[]} instructions - Array of instructions to include in the transaction
 * @param {TransactionSigner} feePayer - The signer that will pay for the transaction
 * @param {(Address | string)[]} [lookupTableAddresses] - Optional array of address lookup table addresses to compress the transaction
 *
 * @returns {Promise<Readonly<FullySignedTransaction & TransactionWithLifetime>>} A signed and encoded transaction
 *
 * @example
 * const instructions = [createATAix, createTransferSolInstruction];
 * const feePayer = wallet.publicKey;
 * const message = await buildTransaction(
 *   rpc,
 *   instructions,
 *   feePayer,
 * );
 */
export async function buildTransaction(
  rpc: Rpc<SolanaRpcApi>,
  config: TransactionConfig,
  instructions: IInstruction[],
  feePayer: TransactionSigner | Address,
  lookupTableAddresses?: Address[],
): Promise<Readonly<FullySignedTransaction & TransactionWithLifetime>> {
  return buildTransactionMessage(
    rpc,
    config,
    instructions,
    !("address" in feePayer) ? createNoopSigner(feePayer) : feePayer,
    lookupTableAddresses,
  );
}

async function buildTransactionMessage(
  rpc: Rpc<SolanaRpcApi>,
  config: TransactionConfig,
  instructions: IInstruction[],
  signer: TransactionSigner,
  lookupTableAddresses?: Address[],
) {
  let message = await prepareTransactionMessage(instructions, rpc, signer);

  if (lookupTableAddresses?.length) {
    const lookupTableAccounts = await fetchAllMaybeAddressLookupTable(rpc, lookupTableAddresses);
    const tables = lookupTableAccounts.reduce(
      (prev, account) => {
        if (account.exists) {
          assertAccountDecoded(account);
          prev[account.address] = account.data.addresses;
        }
        return prev;
      },
      {} as { [address: Address]: Address[] },
    );
    message = compressTransactionMessageUsingAddressLookupTables(message, tables);
  }

  return signTransactionMessageWithSigners(await addPriorityInstructions(rpc, message, signer, config));
}

async function prepareTransactionMessage(
  instructions: IInstruction[],
  rpc: Rpc<SolanaRpcApi>,
  signer: TransactionSigner,
) {
  const { value: blockhash } = await rpc
    .getLatestBlockhash({
      commitment: "confirmed",
    })
    .send();
  return pipe(
    createTransactionMessage({ version: 0 }),
    tx => setTransactionMessageLifetimeUsingBlockhash(blockhash, tx),
    tx => setTransactionMessageFeePayerSigner(signer, tx),
    tx => appendTransactionMessageInstructions(instructions, tx),
  );
}
