//
// Copyright (c) Cryptic Dot
//
// Modification based on Orca Whirlpools (https://github.com/orca-so/whirlpools),
// originally licensed under the Apache License, Version 2.0, prior to February 26, 2025.
//
// Modifications licensed under FusionAMM SDK Source-Available License v1.0
// See the LICENSE file in the project root for license information.
//

import type { Address, TransactionSigner } from "@solana/kit";
import { address, lamports, prependTransactionMessageInstruction } from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";

import { type Percentile, TransactionConfig } from "./config";
import type { TxMessage } from "./priorityFees";

export async function processJitoTipForTxMessage(
  message: TxMessage,
  signer: TransactionSigner,
  config: TransactionConfig,
) {
  let jitoTipLamports = BigInt(0);
  const jito = config.jito;

  if (jito.type === "exact") {
    jitoTipLamports = jito.amountLamports;
  } else if (jito.type === "dynamic") {
    jitoTipLamports = await recentJitoTip(config);
  }
  if (jitoTipLamports > 0) {
    return prependTransactionMessageInstruction(
      getTransferSolInstruction({
        source: signer,
        destination: getJitoTipAddress(),
        amount: jitoTipLamports,
      }),
      message,
    );
  } else {
    return message;
  }
}

// returns recent jito tip in lamports
export async function recentJitoTip(config: TransactionConfig) {
  const response = await fetch(`${config.jitoBlockEngineUrl}/api/v1/bundles/tip_floor`);
  if (!response.ok) {
    return BigInt(0);
  }
  const data = await response.json().then(res => res[0]);

  const percentileToKey: Record<Percentile | "50ema", string> = {
    "25": "landed_tips_25th_percentile",
    "50": "landed_tips_50th_percentile",
    "75": "landed_tips_75th_percentile",
    "95": "landed_tips_95th_percentile",
    "99": "landed_tips_99th_percentile",
    "50ema": "ema_landed_tips_50th_percentile",
  };

  const key = percentileToKey[config.priorityFee.priorityFeePercentile ?? "50"];
  if (!key || !data[key]) {
    return BigInt(0);
  }
  return lamports(BigInt(Math.floor(Number(data[key]) * 10 ** 9))).valueOf();
}

// should we add an argument that dictates if we should use cached value in case fetch fails ?

// below is taken from legacy sdk (no need to add the whole library)
// https://jito-foundation.gitbook.io/mev/mev-payment-and-distribution/on-chain-addresses
const jitoTipAddresses = [
  "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
  "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
  "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
  "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
  "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
  "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
  "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
  "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT",
];

function getJitoTipAddress(): Address {
  // just pick a random one from the list. There are multiple addresses so that no single one
  // can cause local congestion.
  return address(jitoTipAddresses[Math.floor(Math.random() * jitoTipAddresses.length)]);
}
