//
// Copyright (c) Cryptic Dot
//
// Modification based on Orca Whirlpools (https://github.com/orca-so/whirlpools),
// originally licensed under the Apache License, Version 2.0, prior to February 26, 2025.
//
// Modifications licensed under FusionAMM SDK Source-Available License v1.0
// See the LICENSE file in the project root for license information.
//

import { fetchAllTickArray, FusionPool, maybeTickToFacade } from "@crypticdot/fusionamm-client";
import {
  fetchFusionPool,
  fetchPosition,
  getClosePositionInstruction,
  getCollectFeesInstruction,
  getDecreaseLiquidityInstruction,
  getPositionAddress,
  getTickArrayAddress,
} from "@crypticdot/fusionamm-client";
import type { CollectFeesQuote, DecreaseLiquidityQuote, TickRange, TransferFee } from "@crypticdot/fusionamm-core";
import {
  collectFeesQuote,
  decreaseLiquidityQuote,
  decreaseLiquidityQuoteA,
  decreaseLiquidityQuoteB,
  getTickArrayStartTickIndex,
  getTickIndexInArray,
} from "@crypticdot/fusionamm-core";
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
import { fetchAllMaybeMint, fetchAllMint, TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import assert from "assert";

import { DEFAULT_ADDRESS, FUNDER, SLIPPAGE_TOLERANCE_BPS } from "./config";
import { getCurrentTransferFee, prepareTokenAccountsInstructions } from "./token";

// TODO: allow specify number as well as bigint
// TODO: transfer hook

/**
 * Represents the parameters for decreasing liquidity.
 * You must choose only one of the properties (`liquidity`, `tokenA`, or `tokenB`).
 * The SDK will compute the other two based on the input provided.
 */
export type DecreaseLiquidityQuoteParam =
  | {
      /** The amount of liquidity to decrease.*/
      liquidity: bigint;
    }
  | {
      /** The amount of Token A to withdraw.*/
      tokenA: bigint;
    }
  | {
      /** The amount of Token B to withdraw.*/
      tokenB: bigint;
    };

/**
 * Represents the instructions and quote for decreasing liquidity in a position.
 */
export type DecreaseLiquidityInstructions = {
  /** The quote details for decreasing liquidity, including the liquidity delta, estimated tokens, and minimum token amounts based on slippage tolerance. */
  quote: DecreaseLiquidityQuote;

  /** The list of instructions required to decrease liquidity. */
  instructions: IInstruction[];
};

function getDecreaseLiquidityQuote(
  param: DecreaseLiquidityQuoteParam,
  pool: FusionPool,
  tickRange: TickRange,
  slippageToleranceBps: number,
  transferFeeA: TransferFee | undefined,
  transferFeeB: TransferFee | undefined,
): DecreaseLiquidityQuote {
  if ("liquidity" in param) {
    return decreaseLiquidityQuote(
      param.liquidity,
      slippageToleranceBps,
      pool.sqrtPrice,
      tickRange.tickLowerIndex,
      tickRange.tickUpperIndex,
      transferFeeA,
      transferFeeB,
    );
  } else if ("tokenA" in param) {
    return decreaseLiquidityQuoteA(
      param.tokenA,
      slippageToleranceBps,
      pool.sqrtPrice,
      tickRange.tickLowerIndex,
      tickRange.tickUpperIndex,
      transferFeeA,
      transferFeeB,
    );
  } else {
    return decreaseLiquidityQuoteB(
      param.tokenB,
      slippageToleranceBps,
      pool.sqrtPrice,
      tickRange.tickLowerIndex,
      tickRange.tickUpperIndex,
      transferFeeA,
      transferFeeB,
    );
  }
}

/**
 * Generates instructions to decrease liquidity from an existing position in a Fusion Pool.
 *
 * @param {SolanaRpc} rpc - A Solana RPC client for fetching necessary accounts and pool data.
 * @param {Address} positionMintAddress - The mint address of the NFT that represents ownership of the position from which liquidity will be removed.
 * @param {DecreaseLiquidityQuoteParam} param - Defines the liquidity removal method (liquidity, tokenA, or tokenB).
 * @param {number} [slippageToleranceBps=SLIPPAGE_TOLERANCE_BPS] - The acceptable slippage tolerance in basis points.
 * @param {TransactionSigner} [authority=FUNDER] - The account authorizing the liquidity removal.
 *
 * @returns {Promise<DecreaseLiquidityInstructions>} A promise resolving to an object containing the decrease liquidity quote and instructions.
 *
 * @example
 * import { decreaseLiquidityInstructions, setFusionPoolsConfig } from '@crypticdot/fusionamm';
 * import { createSolanaRpc, devnet, address } from '@solana/kit';
 * import { loadWallet } from './utils';
 *
 * await setFusionPoolsConfig('solanaDevnet');
 * const devnetRpc = createSolanaRpc(devnet('https://api.devnet.solana.com'));
 * const wallet = await loadWallet();
 * const positionMint = address("HqoV7Qv27REUtmd9UKSJGGmCRNx3531t33bDG1BUfo9K");
 * const param = { tokenA: 10n };
 * const { quote, instructions } = await decreaseLiquidityInstructions(
 *   devnetRpc,
 *   positionMint,
 *   param,
 *   100,
 *   wallet
 * );
 *
 * console.log(`Quote token max B: ${quote.tokenEstB}`);
 */
export async function decreaseLiquidityInstructions(
  rpc: Rpc<GetAccountInfoApi & GetMultipleAccountsApi & GetMinimumBalanceForRentExemptionApi & GetEpochInfoApi>,
  positionMintAddress: Address,
  param: DecreaseLiquidityQuoteParam,
  slippageToleranceBps: number = SLIPPAGE_TOLERANCE_BPS,
  authority: TransactionSigner = FUNDER,
): Promise<DecreaseLiquidityInstructions> {
  assert(authority.address !== DEFAULT_ADDRESS, "Either supply the authority or set the default funder");

  const positionAddress = await getPositionAddress(positionMintAddress);
  const position = await fetchPosition(rpc, positionAddress[0]);
  const fusionPool = await fetchFusionPool(rpc, position.data.fusionPool);

  const currentEpoch = await rpc.getEpochInfo().send();
  const [mintA, mintB, positionMint] = await fetchAllMint(rpc, [
    fusionPool.data.tokenMintA,
    fusionPool.data.tokenMintB,
    positionMintAddress,
  ]);
  const transferFeeA = getCurrentTransferFee(mintA, currentEpoch.epoch);
  const transferFeeB = getCurrentTransferFee(mintB, currentEpoch.epoch);

  const quote = getDecreaseLiquidityQuote(
    param,
    fusionPool.data,
    position.data,
    slippageToleranceBps,
    transferFeeA,
    transferFeeB,
  );
  const instructions: IInstruction[] = [];

  const lowerTickArrayStartIndex = getTickArrayStartTickIndex(
    position.data.tickLowerIndex,
    fusionPool.data.tickSpacing,
  );
  const upperTickArrayStartIndex = getTickArrayStartTickIndex(
    position.data.tickUpperIndex,
    fusionPool.data.tickSpacing,
  );

  const [positionTokenAccount, tickArrayLower, tickArrayUpper] = await Promise.all([
    findAssociatedTokenPda({
      owner: authority.address,
      mint: positionMintAddress,
      tokenProgram: positionMint.programAddress,
    }).then(x => x[0]),
    getTickArrayAddress(fusionPool.address, lowerTickArrayStartIndex).then(x => x[0]),
    getTickArrayAddress(fusionPool.address, upperTickArrayStartIndex).then(x => x[0]),
  ]);

  const { createInstructions, cleanupInstructions, tokenAccountAddresses } = await prepareTokenAccountsInstructions(
    rpc,
    authority,
    [fusionPool.data.tokenMintA, fusionPool.data.tokenMintB],
  );

  instructions.push(...createInstructions);

  instructions.push(
    getDecreaseLiquidityInstruction({
      fusionPool: fusionPool.address,
      positionAuthority: authority,
      position: position.address,
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
      tickArrayLower,
      tickArrayUpper,
      liquidityAmount: quote.liquidityDelta,
      tokenMinA: quote.tokenMinA,
      tokenMinB: quote.tokenMinB,
      remainingAccountsInfo: null,
    }),
  );

  instructions.push(...cleanupInstructions);

  return { quote, instructions };
}

/**
 * Represents the instructions and quotes for closing a liquidity position in a Fusion Pool.
 * Extends `DecreaseLiquidityInstructions` and adds additional fee and reward details.
 */
export type ClosePositionInstructions = DecreaseLiquidityInstructions & {
  /** The fees collected from the position, including the amounts for token A (`fee_owed_a`) and token B (`fee_owed_b`). */
  feesQuote: CollectFeesQuote;
};

/**
 * Generates instructions to close a liquidity position in FusionPool. This includes collecting all fees,
 * rewards, removing any remaining liquidity, and closing the position.
 *
 * @param {SolanaRpc} rpc - A Solana RPC client for fetching accounts and pool data.
 * @param {Address} positionMintAddress - The mint address of the NFT that represents ownership of the position to be closed.
 * @param {number} [slippageToleranceBps=SLIPPAGE_TOLERANCE_BPS] - The acceptable slippage tolerance in basis points.
 * @param {TransactionSigner} [authority=FUNDER] - The account authorizing the transaction.
 *
 * @returns {Promise<ClosePositionInstructions>} A promise resolving to an object containing instructions, fees quote, rewards quote, and the liquidity quote for the closed position.
 *
 * @example
 * import { closePositionInstructions, setFusionPoolsConfig } from '@crypticdot/fusionamm';
 * import { createSolanaRpc, devnet, address } from '@solana/kit';
 * import { loadWallet } from './utils';
 *
 * await setFusionPoolsConfig('solanaDevnet');
 * const devnetRpc = createSolanaRpc(devnet('https://api.devnet.solana.com'));
 * const wallet = await loadWallet();
 * const positionMint = address("HqoV7Qv27REUtmd9UKSJGGmCRNx3531t33bDG1BUfo9K");
 *
 * const { instructions, quote, feesQuote } = await closePositionInstructions(
 *   devnetRpc,
 *   positionMint,
 *   100,
 *   wallet
 * );
 *
 * console.log(`Quote token max B: ${quote.tokenEstB}`);
 * console.log(`Fees owed token A: ${feesQuote.feeOwedA}`);
 * console.log(`Number of instructions:, ${instructions.length}`);
 */
export async function closePositionInstructions(
  rpc: Rpc<GetAccountInfoApi & GetMultipleAccountsApi & GetMinimumBalanceForRentExemptionApi & GetEpochInfoApi>,
  positionMintAddress: Address,
  slippageToleranceBps: number = SLIPPAGE_TOLERANCE_BPS,
  authority: TransactionSigner = FUNDER,
): Promise<ClosePositionInstructions> {
  assert(authority.address !== DEFAULT_ADDRESS, "Either supply an authority or set the default funder");

  const positionAddress = await getPositionAddress(positionMintAddress);
  const position = await fetchPosition(rpc, positionAddress[0]);
  const fusionPool = await fetchFusionPool(rpc, position.data.fusionPool);

  const currentEpoch = await rpc.getEpochInfo().send();
  const [mintA, mintB, positionMint] = await fetchAllMaybeMint(rpc, [
    fusionPool.data.tokenMintA,
    fusionPool.data.tokenMintB,
    positionMintAddress,
  ]);

  assert(mintA.exists, "Token A not found");
  assert(mintB.exists, "Token B not found");
  assert(positionMint.exists, "Position mint not found");

  const transferFeeA = getCurrentTransferFee(mintA, currentEpoch.epoch);
  const transferFeeB = getCurrentTransferFee(mintB, currentEpoch.epoch);

  const quote = getDecreaseLiquidityQuote(
    { liquidity: position.data.liquidity },
    fusionPool.data,
    position.data,
    slippageToleranceBps,
    transferFeeA,
    transferFeeB,
  );

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
    transferFeeA,
    transferFeeB,
  );

  const requiredMints: Set<Address> = new Set();
  if (quote.liquidityDelta > 0n || feesQuote.feeOwedA > 0n || feesQuote.feeOwedB > 0n) {
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

  if (quote.liquidityDelta > 0n) {
    instructions.push(
      getDecreaseLiquidityInstruction({
        fusionPool: fusionPool.address,
        positionAuthority: authority,
        position: positionAddress[0],
        positionTokenAccount,
        tokenOwnerAccountA: tokenAccountAddresses[fusionPool.data.tokenMintA],
        tokenOwnerAccountB: tokenAccountAddresses[fusionPool.data.tokenMintB],
        tokenVaultA: fusionPool.data.tokenVaultA,
        tokenVaultB: fusionPool.data.tokenVaultB,
        tickArrayLower: lowerTickArrayAddress,
        tickArrayUpper: upperTickArrayAddress,
        liquidityAmount: quote.liquidityDelta,
        tokenMinA: quote.tokenMinA,
        tokenMinB: quote.tokenMinB,
        tokenMintA: fusionPool.data.tokenMintA,
        tokenMintB: fusionPool.data.tokenMintB,
        tokenProgramA: mintA.programAddress,
        tokenProgramB: mintB.programAddress,
        memoProgram: MEMO_PROGRAM_ADDRESS,
        remainingAccountsInfo: null,
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

  switch (positionMint.programAddress) {
    case TOKEN_2022_PROGRAM_ADDRESS:
      instructions.push(
        getClosePositionInstruction({
          positionAuthority: authority,
          position: positionAddress[0],
          positionTokenAccount,
          positionMint: positionMintAddress,
          receiver: authority.address,
          token2022Program: TOKEN_2022_PROGRAM_ADDRESS,
        }),
      );
      break;
    default:
      throw new Error("Invalid token program");
  }

  instructions.push(...cleanupInstructions);

  return {
    instructions,
    quote,
    feesQuote,
  };
}
