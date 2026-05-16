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
  fetchAllTickArray,
  fetchFusionPool,
  fetchPosition,
  getCollectFeesInstruction,
  getPositionAddress,
  getTickArrayAddress,
  getUpdateFeesInstruction,
  maybeTickToFacade,
} from "@crypticdot/fusionamm-client";
import type { CollectFeesQuote } from "@crypticdot/fusionamm-core";
import { collectFeesQuote, getTickArrayStartTickIndex, getTickIndexInArray } from "@crypticdot/fusionamm-core";
import type {
  Address,
  GetAccountInfoApi,
  GetEpochInfoApi,
  GetMinimumBalanceForRentExemptionApi,
  GetMultipleAccountsApi,
  IInstruction,
  Rpc,
  TransactionSigner,
} from "@solana/kit";
import { MEMO_PROGRAM_ADDRESS } from "@solana-program/memo";
import { findAssociatedTokenPda } from "@solana-program/token";
import { fetchAllMaybeMint } from "@solana-program/token-2022";
import assert from "assert";

import { DEFAULT_ADDRESS, FUNDER } from "./config";
import { getCurrentTransferFee, prepareTokenAccountsInstructions } from "./token";

// TODO: Transfer hook

/**
 * Represents the instructions and quotes for harvesting a position.
 */
export type HarvestPositionInstructions = {
  /** A breakdown of the fees owed to the position owner, detailing the amounts for token A (`fee_owed_a`) and token B (`fee_owed_b`). */
  feesQuote: CollectFeesQuote;

  /** A list of instructions required to harvest the position. */
  instructions: IInstruction[];
};

/**
 * This function creates a set of instructions that collect any accumulated fees from a position.
 * The liquidity remains in place, and the position stays open.
 *
 * @param {SolanaRpc} rpc
 *    A Solana RPC client used to interact with the blockchain.
 * @param {Address} positionMintAddress
 *    The position mint address you want to harvest fees from.
 * @param {TransactionSigner} [authority=FUNDER]
 *    The account that authorizes the transaction. Defaults to a predefined funder.
 *
 * @returns {Promise<HarvestPositionInstructions>}
 *    A promise that resolves to an object containing the instructions, fees quotes.
 * @example
 * import { harvestPositionInstructions, setFusionPoolsConfig } from '@crypticdot/fusionamm';
 * import { createSolanaRpc, devnet, address } from '@solana/kit';
 * import { loadWallet } from './utils';
 *
 * await setFusionPoolsConfig('solanaDevnet');
 * const devnetRpc = createSolanaRpc(devnet('https://api.devnet.solana.com'));
 * const wallet = await loadWallet();
 * const positionMint = address("HqoV7Qv27REUtmd9UKSJGGmCRNx3531t33bDG1BUfo9K");
 *
 * const { feesQuote, instructions } = await harvestPositionInstructions(
 *   devnetRpc,
 *   positionMint,
 *   wallet
 * );
 *
 * console.log(`Fees owed token A: ${feesQuote.feeOwedA}`);
 */
export async function harvestPositionInstructions(
  rpc: Rpc<GetAccountInfoApi & GetMultipleAccountsApi & GetMinimumBalanceForRentExemptionApi & GetEpochInfoApi>,
  positionMintAddress: Address,
  authority: TransactionSigner = FUNDER,
): Promise<HarvestPositionInstructions> {
  assert(authority.address !== DEFAULT_ADDRESS, "Either supply an authority or set the default funder");

  const currentEpoch = await rpc.getEpochInfo().send();
  const positionAddress = await getPositionAddress(positionMintAddress);
  const position = await fetchPosition(rpc, positionAddress[0]);
  const fusionPool = await fetchFusionPool(rpc, position.data.fusionPool);
  const [mintA, mintB, positionMint] = await fetchAllMaybeMint(rpc, [
    fusionPool.data.tokenMintA,
    fusionPool.data.tokenMintB,
    positionMintAddress,
  ]);

  assert(mintA.exists, "Token A not found");
  assert(mintB.exists, "Token B not found");
  assert(positionMint.exists, "Position mint not found");

  const lowerTickArrayStartIndex = getTickArrayStartTickIndex(
    position.data.tickLowerIndex,
    fusionPool.data.tickSpacing,
  );
  const upperTickArrayStartIndex = getTickArrayStartTickIndex(
    position.data.tickUpperIndex,
    fusionPool.data.tickSpacing,
  );

  const [positionTokenAccount, lowerTickArrayAddress, upperTickArrayAddress] = await Promise.all([
    findAssociatedTokenPda({
      owner: authority.address,
      mint: positionMintAddress,
      tokenProgram: positionMint.programAddress,
    }).then(x => x[0]),
    getTickArrayAddress(fusionPool.address, lowerTickArrayStartIndex).then(x => x[0]),
    getTickArrayAddress(fusionPool.address, upperTickArrayStartIndex).then(x => x[0]),
  ]);

  const [lowerTickArray, upperTickArray] = await fetchAllTickArray(rpc, [lowerTickArrayAddress, upperTickArrayAddress]);

  const lowerTick =
    lowerTickArray.data.ticks[
      getTickIndexInArray(position.data.tickLowerIndex, lowerTickArrayStartIndex, fusionPool.data.tickSpacing)
    ];
  const upperTick =
    upperTickArray.data.ticks[
      getTickIndexInArray(position.data.tickUpperIndex, upperTickArrayStartIndex, fusionPool.data.tickSpacing)
    ];

  const feesQuote = collectFeesQuote(
    fusionPool.data,
    position.data,
    maybeTickToFacade(lowerTick),
    maybeTickToFacade(upperTick),
    getCurrentTransferFee(mintA, currentEpoch.epoch),
    getCurrentTransferFee(mintB, currentEpoch.epoch),
  );

  const requiredMints: Set<Address> = new Set();
  if (feesQuote.feeOwedA > 0n || feesQuote.feeOwedB > 0n) {
    requiredMints.add(fusionPool.data.tokenMintA);
    requiredMints.add(fusionPool.data.tokenMintB);
  }

  const { createInstructions, cleanupInstructions, tokenAccountAddresses } = await prepareTokenAccountsInstructions(
    rpc,
    authority,
    Array.from(requiredMints),
  );

  const instructions: IInstruction[] = [];
  instructions.push(...createInstructions);

  if (position.data.liquidity > 0n) {
    instructions.push(
      getUpdateFeesInstruction({
        fusionPool: fusionPool.address,
        position: positionAddress[0],
        tickArrayLower: lowerTickArrayAddress,
        tickArrayUpper: upperTickArrayAddress,
      }),
    );
  }

  if (feesQuote.feeOwedA > 0n || feesQuote.feeOwedB > 0n) {
    instructions.push(
      getCollectFeesInstruction({
        fusionPool: fusionPool.address,
        positionAuthority: authority,
        position: positionAddress[0],
        positionTokenAccount,
        tokenOwnerAccountA: tokenAccountAddresses[fusionPool.data.tokenMintA],
        tokenOwnerAccountB: tokenAccountAddresses[fusionPool.data.tokenMintB],
        tokenVaultA: fusionPool.data.tokenVaultA,
        tokenVaultB: fusionPool.data.tokenVaultB,
        tokenMintA: fusionPool.data.tokenMintA,
        tokenMintB: fusionPool.data.tokenMintB,
        tokenProgramA: mintA.programAddress,
        tokenProgramB: mintB.programAddress,
        memoProgram: MEMO_PROGRAM_ADDRESS,
        remainingAccountsInfo: null,
      }),
    );
  }

  instructions.push(...cleanupInstructions);

  return {
    feesQuote,
    instructions,
  };
}
