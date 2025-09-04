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
  CompilableTransactionMessage,
  IInstruction,
  Rpc,
  SolanaRpcApi,
  TransactionSigner,
  IAccountLookupMeta,
  IAccountMeta,
  ITransactionMessageWithFeePayerSigner,
  TransactionMessageWithBlockhashLifetime,
  TransactionVersion,
} from "@solana/kit";
import { getComputeUnitEstimateForTransactionMessageFactory } from "@solana/kit";
import { type TransactionConfig } from "./config";
import { processJitoTipForTxMessage } from "./jito";
import { processComputeBudgetForTxMessage } from "./computeBudget";

export type TxMessage = ITransactionMessageWithFeePayerSigner<string, TransactionSigner<string>> &
  Omit<
    TransactionMessageWithBlockhashLifetime &
      Readonly<{
        instructions: readonly IInstruction<
          string,
          readonly (IAccountLookupMeta<string, string> | IAccountMeta<string>)[]
        >[];
        version: TransactionVersion;
      }>,
    "feePayer"
  >;

export async function addPriorityInstructions(
  rpc: Rpc<SolanaRpcApi>,
  message: TxMessage,
  signer: TransactionSigner,
  config: TransactionConfig,
) {
  if (config.jito.type !== "none") {
    message = await processJitoTipForTxMessage(message, signer, config);
  }

  let computeUnits = 1_400_000;

  try {
    computeUnits = await getComputeUnitsForTxMessage(rpc, message);
  } catch {
    console.warn("Transaction simulation failed, using 1,400,000 compute units");
  }

  return processComputeBudgetForTxMessage(rpc, message, computeUnits, config);
}

async function getComputeUnitsForTxMessage(rpc: Rpc<SolanaRpcApi>, txMessage: CompilableTransactionMessage) {
  const estimator = getComputeUnitEstimateForTransactionMessageFactory({
    rpc,
  });
  return await estimator(txMessage);
}
