//
// Copyright (c) Cryptic Dot
//
// Modification based on Orca Whirlpools (https://github.com/orca-so/whirlpools),
// originally licensed under the Apache License, Version 2.0, prior to February 26, 2025.
//
// Modifications licensed under FusionAMM SDK Source-Available License v1.0
// See the LICENSE file in the project root for license information.
//

/**
 * Default compute unit margin multiplier used to ensure sufficient compute budget.
 */
export const DEFAULT_COMPUTE_UNIT_MARGIN_MULTIPLIER = 1.15;

/**
 * Default prioritization settings, including priority fees and Jito tips.
 */
export const DEFAULT_TRANSACTION_CONFIG: TransactionConfig = {
  priorityFee: {
    type: "none",
    priorityFeePercentile: "50",
  },
  jito: {
    type: "none",
    priorityFeePercentile: "50",
  },
  computeUnitMarginMultiplier: DEFAULT_COMPUTE_UNIT_MARGIN_MULTIPLIER,
  jitoBlockEngineUrl: "https://bundles.jito.wtf",
};

/*
async function getChainIdFromGenesisHash(rpc: Rpc<SolanaRpcApi>): Promise<ChainId> {
  // not all rpc endpoints support getGenesisHash
  try {
    const genesisHash = await rpc.getGenesisHash().send();
    const genesisHashToChainId: Record<string, ChainId> = {
      "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d": "solana",
      EAQLJCV2mh23BsK2P9oYpV5CHVLDNHTxYss3URrNmg3s: "eclipse",
      EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG: "solana-devnet",
      CX4huckiV9QNAkKNVKi5Tj8nxzBive5kQimd94viMKsU: "eclipse-testnet",
    };
    return genesisHashToChainId[genesisHash] || "unknown";
  } catch (error) {
    console.warn("Error getting chain ID from genesis hash", error);
    return "unknown";
  }
}
 */

type FeeSetting =
  | {
      type: "dynamic";
      maxCapLamports?: bigint;
    }
  | {
      type: "exact";
      amountLamports: bigint;
    }
  | {
      type: "none";
    };

/**
 * Configuration for transaction fees, including Jito and priority fee settings.
 */
export type JitoFeeSetting = FeeSetting & {
  priorityFeePercentile?: Percentile | "50ema";
};

export type PriorityFeeSetting = FeeSetting & {
  priorityFeePercentile?: Percentile;
};

export type TransactionConfig = {
  jito: JitoFeeSetting;
  priorityFee: PriorityFeeSetting;
  computeUnitMarginMultiplier: number;
  jitoBlockEngineUrl: string;
};

/**
 * Defines a percentile value for priority fee selection.
 */
export type Percentile = "25" | "50" | "75" | "95" | "99";

/**
 * Represents a supported blockchain network chain ID.
 */
export type ChainId = "solana" | "eclipse" | "solana-devnet" | "eclipse-testnet" | "unknown";
