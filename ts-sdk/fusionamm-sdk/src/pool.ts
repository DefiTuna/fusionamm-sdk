//
// Copyright (c) Cryptic Dot
//
// Modification based on Orca Whirlpools (https://github.com/orca-so/whirlpools),
// originally licensed under the Apache License, Version 2.0, prior to February 26, 2025.
//
// Modifications licensed under FusionAMM SDK Source-Available License v1.0
// See the LICENSE file in the project root for license information.
//

import {
  fetchAllFusionPoolWithFilter,
  fetchFusionPool,
  FusionPool,
  fusionPoolTokenMintAFilter,
  getFusionPoolAddress,
} from "@crypticdot/fusionamm-client";
import type {
  Account,
  Address,
  GetAccountInfoApi,
  GetMultipleAccountsApi,
  GetProgramAccountsApi,
  Rpc,
} from "@solana/kit";

import { orderMints } from "./token";

/**
 * Fetches the details of a specific Concentrated Liquidity Pool.
 *
 * @param {SolanaRpc} rpc - The Solana RPC client.
 * @param {Address} tokenMintOne - The first token mint address in the pool.
 * @param {Address} tokenMintTwo - The second token mint address in the pool.
 * @param {number} tickSpacing - The tick spacing of the pool.
 * @returns {Promise<Account<FusionPool>>} - A promise that resolves to the pool information, which includes whether the pool is initialized or not.
 */
export async function fetchFusionPoolByTokenPairAndTickSpacing(
  rpc: Rpc<GetAccountInfoApi & GetMultipleAccountsApi>,
  tokenMintOne: Address,
  tokenMintTwo: Address,
  tickSpacing: number,
): Promise<Account<FusionPool>> {
  const [tokenMintA, tokenMintB] = orderMints(tokenMintOne, tokenMintTwo);
  const poolAddress = await getFusionPoolAddress(tokenMintA, tokenMintB, tickSpacing).then(x => x[0]);

  return await fetchFusionPool(rpc, poolAddress);
}

/**
 * Fetches all possible liquidity pools between two token mints.
 *
 * @param {SolanaRpc} rpc - The Solana RPC client.
 * @param {Address} tokenMintOne - The first token mint address in the pool.
 * @param {Address} tokenMintTwo - The second token mint address in the pool.
 * @returns {Promise<Account<FusionPool>[]>} - A promise that resolves to an array of pool information for each pool between the two tokens.
 *
 */
export async function fetchFusionPoolsByTokenPair(
  rpc: Rpc<GetAccountInfoApi & GetMultipleAccountsApi & GetProgramAccountsApi>,
  tokenMintOne: Address,
  tokenMintTwo: Address,
): Promise<Account<FusionPool>[]> {
  const [tokenMintA, tokenMintB] = orderMints(tokenMintOne, tokenMintTwo);

  return await fetchAllFusionPoolWithFilter(
    rpc,
    fusionPoolTokenMintAFilter(tokenMintA),
    fusionPoolTokenMintAFilter(tokenMintB),
  );
}
