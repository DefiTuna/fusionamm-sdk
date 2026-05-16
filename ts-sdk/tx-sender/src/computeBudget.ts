//
// Copyright (c) Cryptic Dot
//
// Modification based on Orca Whirlpools (https://github.com/orca-so/whirlpools),
// originally licensed under the Apache License, Version 2.0, prior to February 26, 2025.
//
// Modifications licensed under FusionAMM SDK Source-Available License v1.0
// See the LICENSE file in the project root for license information.
//

import type { Address, IInstruction, Rpc, SolanaRpcApi } from "@solana/kit";
import { isWritableRole, prependTransactionMessageInstruction } from "@solana/kit";
import { getSetComputeUnitLimitInstruction, getSetComputeUnitPriceInstruction } from "@solana-program/compute-budget";

import type { Percentile, TransactionConfig } from "./config";
import { DEFAULT_COMPUTE_UNIT_MARGIN_MULTIPLIER } from "./config";
import type { TxMessage } from "./priorityFees";

export async function processComputeBudgetForTxMessage(
  rpc: Rpc<SolanaRpcApi>,
  message: TxMessage,
  computeUnits: number,
  config: TransactionConfig,
) {
  const priorityFee = config.priorityFee;
  const computeUnitMarginMultiplier = config.computeUnitMarginMultiplier;
  let priorityFeeMicroLamports = BigInt(0);
  if (priorityFee.type === "exact") {
    priorityFeeMicroLamports = (priorityFee.amountLamports * BigInt(1_000_000)) / BigInt(computeUnits);
  } else if (priorityFee.type === "dynamic") {
    const estimatedPriorityFee = await calculateDynamicPriorityFees(
      rpc,
      message.instructions,
      priorityFee.priorityFeePercentile ?? "50",
    );

    if (!priorityFee.maxCapLamports) {
      priorityFeeMicroLamports = estimatedPriorityFee;
    } else {
      const maxCapMicroLamports = (priorityFee.maxCapLamports * BigInt(1_000_000)) / BigInt(computeUnits);

      priorityFeeMicroLamports =
        maxCapMicroLamports > estimatedPriorityFee ? estimatedPriorityFee : maxCapMicroLamports;
    }
  }

  if (priorityFeeMicroLamports > 0) {
    message = prependTransactionMessageInstruction(
      getSetComputeUnitPriceInstruction({
        microLamports: priorityFeeMicroLamports,
      }),
      message,
    );
  }
  message = prependTransactionMessageInstruction(
    getSetComputeUnitLimitInstruction({
      units: Math.ceil(computeUnits * (computeUnitMarginMultiplier ?? DEFAULT_COMPUTE_UNIT_MARGIN_MULTIPLIER)),
    }),
    message,
  );

  return message;
}

function getWritableAccounts(ixs: readonly IInstruction[]) {
  const writable = new Set<Address>();
  ixs.forEach(ix => {
    if (ix.accounts) {
      ix.accounts.forEach(acc => {
        if (isWritableRole(acc.role)) writable.add(acc.address);
      });
    }
  });
  return Array.from(writable);
}

async function calculateDynamicPriorityFees(
  rpc: Rpc<SolanaRpcApi>,
  instructions: readonly IInstruction[],
  percentile: Percentile,
) {
  const writableAccounts = getWritableAccounts(instructions);
  const recent = await rpc.getRecentPrioritizationFees(writableAccounts).send();
  const nonZero = recent.filter(pf => pf.prioritizationFee > 0).map(pf => pf.prioritizationFee);
  const sorted = nonZero.sort((a, b) => Number(a - b));
  return sorted[Math.floor(sorted.length * (parseInt(percentile) / 100))] || BigInt(0);
}
