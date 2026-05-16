//
// Copyright (c) Cryptic Dot
//
// Modification based on Orca Whirlpools (https://github.com/orca-so/whirlpools),
// originally licensed under the Apache License, Version 2.0, prior to February 26, 2025.
//
// Modifications licensed under FusionAMM SDK Source-Available License v1.0
// See the LICENSE file in the project root for license information.
//

import type { Account, Address, GetProgramAccountsApi, GetProgramAccountsMemcmpFilter, Rpc } from "@solana/kit";
import { getAddressEncoder, getBase58Decoder, getU16Encoder } from "@solana/kit";

import type { FusionPool } from "../generated";
import { FUSION_POOL_DISCRIMINATOR, FUSIONAMM_PROGRAM_ADDRESS, getFusionPoolDecoder } from "../generated";

import { fetchDecodedProgramAccounts } from "./utils";

export type FusionPoolFilter = GetProgramAccountsMemcmpFilter & {
  readonly __kind: unique symbol;
};

export function fusionPoolTokenMintAFilter(tokenMintA: Address): FusionPoolFilter {
  return {
    memcmp: {
      offset: 11n,
      bytes: getBase58Decoder().decode(getAddressEncoder().encode(tokenMintA)),
      encoding: "base58",
    },
  } as FusionPoolFilter;
}

export function fusionPoolTokenMintBFilter(tokenMintB: Address): FusionPoolFilter {
  return {
    memcmp: {
      offset: 43n,
      bytes: getBase58Decoder().decode(getAddressEncoder().encode(tokenMintB)),
      encoding: "base58",
    },
  } as FusionPoolFilter;
}

export function fusionPoolTokenVaultAFilter(tokenVaultA: Address): FusionPoolFilter {
  return {
    memcmp: {
      offset: 75n,
      bytes: getBase58Decoder().decode(getAddressEncoder().encode(tokenVaultA)),
      encoding: "base58",
    },
  } as FusionPoolFilter;
}

export function fusionPoolTokenVaultBFilter(tokenVaultB: Address): FusionPoolFilter {
  return {
    memcmp: {
      offset: 107n,
      bytes: getBase58Decoder().decode(getAddressEncoder().encode(tokenVaultB)),
      encoding: "base58",
    },
  } as FusionPoolFilter;
}

export function fusionPoolTickSpacingFilter(tickSpacing: number): FusionPoolFilter {
  return {
    memcmp: {
      offset: 139n,
      bytes: getBase58Decoder().decode(getU16Encoder().encode(tickSpacing)),
      encoding: "base58",
    },
  } as FusionPoolFilter;
}

export function fusionPoolFeeRateFilter(defaultFeeRate: number): FusionPoolFilter {
  return {
    memcmp: {
      offset: 143n,
      bytes: getBase58Decoder().decode(getU16Encoder().encode(defaultFeeRate)),
      encoding: "base58",
    },
  } as FusionPoolFilter;
}

export function fusionPoolProtocolFeeRateFilter(protocolFeeRate: number): FusionPoolFilter {
  return {
    memcmp: {
      offset: 145n,
      bytes: getBase58Decoder().decode(getU16Encoder().encode(protocolFeeRate)),
      encoding: "base58",
    },
  } as FusionPoolFilter;
}

/**
 * Fetches all FusionPool accounts with the specified filters.
 *
 * This function fetches all FusionPool accounts from the blockchain that match the specified filters.
 * It uses the FusionPool discriminator to identify FusionPool accounts and applies additional filters
 * provided as arguments.
 *
 * @param {Rpc<GetProgramAccountsApi>} rpc - The Solana RPC client to fetch program accounts.
 * @param {...FusionPoolFilter[]} filters - The filters to apply when fetching FusionPool accounts.
 * @returns {Promise<Account<FusionPool>[]>} A promise that resolves to an array of FusionPool accounts.
 *
 * @example
 * import { address, createSolanaRpc, devnet } from "@solana/kit";
 * import { fetchAllFusionPoolWithFilter } from "@crypticdot/fusionamm-client";
 *
 * const rpcDevnet = createSolanaRpc(devnet("https://api.devnet.solana.com"));
 * const FUSIONPOOLS_CONFIG_ADDRESS_DEVNET = address("FcrweFY1G9HJAHG5inkGB6pKg1HZ6x9UC2WioAfWrGkR");
 * const fusionPools = await fetchAllFusionPoolWithFilter(rpcDevnet, fusionPoolFusionPoolConfigFilter(FUSIONPOOLS_CONFIG_ADDRESS_DEVNET));
 */
export async function fetchAllFusionPoolWithFilter(
  rpc: Rpc<GetProgramAccountsApi>,
  ...filters: FusionPoolFilter[]
): Promise<Account<FusionPool>[]> {
  const discriminator = getBase58Decoder().decode(FUSION_POOL_DISCRIMINATOR);
  const discriminatorFilter: GetProgramAccountsMemcmpFilter = {
    memcmp: {
      offset: 0n,
      bytes: discriminator,
      encoding: "base58",
    },
  };
  return fetchDecodedProgramAccounts(
    rpc,
    FUSIONAMM_PROGRAM_ADDRESS,
    [discriminatorFilter, ...filters],
    getFusionPoolDecoder(),
  );
}
