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
  fetchAllMaybeTickArray,
  fetchFusionPool,
  fetchPosition,
  FP_NFT_UPDATE_AUTH,
  FusionPool,
  getIncreaseLiquidityInstruction,
  getInitializeTickArrayInstruction,
  getOpenPositionInstruction,
  getOpenPositionInstructionWithEphemeralSigner,
  getPositionAddress,
  getTickArrayAddress,
  getTickArrayMinSize,
} from "@crypticdot/fusionamm-client";
import type { IncreaseLiquidityQuote, TransferFee } from "@crypticdot/fusionamm-core";
import {
  getFullRangeTickIndexes,
  getInitializableTickIndex,
  getTickArrayStartTickIndex,
  increaseLiquidityQuote,
  increaseLiquidityQuoteA,
  increaseLiquidityQuoteB,
  orderTickIndexes,
  priceToTickIndex,
} from "@crypticdot/fusionamm-core";
import type {
  Account,
  Address,
  GetAccountInfoApi,
  GetEpochInfoApi,
  GetMinimumBalanceForRentExemptionApi,
  GetMultipleAccountsApi,
  IInstruction,
  Lamports,
  Rpc,
  TransactionSigner,
} from "@solana/kit";
import { lamports } from "@solana/kit";
import { fetchSysvarRent } from "@solana/sysvars";
import { MEMO_PROGRAM_ADDRESS } from "@solana-program/memo";
import { ASSOCIATED_TOKEN_PROGRAM_ADDRESS, findAssociatedTokenPda } from "@solana-program/token";
import type { Mint } from "@solana-program/token-2022";
import { fetchAllMint, TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import assert from "assert";

import { DEFAULT_ADDRESS, FUNDER, SLIPPAGE_TOLERANCE_BPS } from "./config";
import { calculateMinimumBalanceForRentExemption } from "./sysvar";
import { getCurrentTransferFee, prepareTokenAccountsInstructions } from "./token";
import { PriceOrTickIndex } from "./types";

// TODO: allow specify number as well as bigint
// TODO: transfer hook

/**
 * Represents the parameters for increasing liquidity.
 * You must choose only one of the properties (`liquidity`, `tokenA`, or `tokenB`).
 * The SDK will compute the other two based on the input provided.
 */
export type IncreaseLiquidityQuoteParam =
  | {
      /** The amount of liquidity to increase. */
      liquidity: bigint;
    }
  | {
      /** The amount of Token A to add. */
      tokenA: bigint;
    }
  | {
      /** The amount of Token B to add. */
      tokenB: bigint;
    };

/**
 * Represents the instructions and quote for increasing liquidity in a position.
 */
export type IncreaseLiquidityInstructions = {
  /** The quote object with details about the increase in liquidity, including the liquidity delta, estimated tokens, and maximum token amounts based on slippage tolerance. */
  quote: IncreaseLiquidityQuote;

  /** List of Solana transaction instructions to execute. */
  instructions: IInstruction[];
};

function getIncreaseLiquidityQuote(
  param: IncreaseLiquidityQuoteParam,
  pool: FusionPool,
  tickLowerIndex: number,
  tickUpperIndex: number,
  slippageToleranceBps: number,
  transferFeeA: TransferFee | undefined,
  transferFeeB: TransferFee | undefined,
): IncreaseLiquidityQuote {
  if ("liquidity" in param) {
    return increaseLiquidityQuote(
      param.liquidity,
      slippageToleranceBps,
      pool.sqrtPrice,
      tickLowerIndex,
      tickUpperIndex,
      transferFeeA,
      transferFeeB,
    );
  } else if ("tokenA" in param) {
    return increaseLiquidityQuoteA(
      param.tokenA,
      slippageToleranceBps,
      pool.sqrtPrice,
      tickLowerIndex,
      tickUpperIndex,
      transferFeeA,
      transferFeeB,
    );
  } else {
    return increaseLiquidityQuoteB(
      param.tokenB,
      slippageToleranceBps,
      pool.sqrtPrice,
      tickLowerIndex,
      tickUpperIndex,
      transferFeeA,
      transferFeeB,
    );
  }
}

/**
 * Generates instructions to increase liquidity for an existing position.
 *
 * @param {SolanaRpc} rpc - The Solana RPC client.
 * @param {Address} positionMintAddress - The mint address of the NFT that represents the position.
 * @param {IncreaseLiquidityQuoteParam} param - The parameters for adding liquidity. Can specify liquidity, Token A, or Token B amounts.
 * @param {number} [slippageToleranceBps=SLIPPAGE_TOLERANCE_BPS] - The maximum acceptable slippage, in basis points (BPS).
 * @param {TransactionSigner} [authority=FUNDER] - The account that authorizes the transaction.
 * @returns {Promise<IncreaseLiquidityInstructions>} A promise that resolves to an object containing instructions, quote, position mint address, and initialization costs for increasing liquidity.
 *
 * @example
 * import { increaseLiquidityInstructions, setFusionPoolsConfig } from '@crypticdot/fusionamm';
 * import { createSolanaRpc, devnet, address } from '@solana/kit';
 * import { loadWallet } from './utils';
 *
 * await setFusionPoolsConfig('solanaDevnet');
 * const devnetRpc = createSolanaRpc(devnet('https://api.devnet.solana.com'));
 * const wallet = await loadWallet();
 * const positionMint = address("HqoV7Qv27REUtmd9UKSJGGmCRNx3531t33bDG1BUfo9K");
 * const param = { tokenA: 10n };
 * const { quote, instructions } = await increaseLiquidityInstructions(
 *   devnetRpc,
 *   positionMint,
 *   param,
 *   100,
 *   wallet
 * );
 *
 * console.log(`Quote token max B: ${quote.tokenEstB}`);
 */
export async function increaseLiquidityInstructions(
  rpc: Rpc<GetAccountInfoApi & GetMultipleAccountsApi & GetMinimumBalanceForRentExemptionApi & GetEpochInfoApi>,
  positionMintAddress: Address,
  param: IncreaseLiquidityQuoteParam,
  slippageToleranceBps: number = SLIPPAGE_TOLERANCE_BPS,
  authority: TransactionSigner = FUNDER,
): Promise<IncreaseLiquidityInstructions> {
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

  const quote = getIncreaseLiquidityQuote(
    param,
    fusionPool.data,
    position.data.tickLowerIndex,
    position.data.tickUpperIndex,
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
    {
      [fusionPool.data.tokenMintA]: quote.tokenMaxA,
      [fusionPool.data.tokenMintB]: quote.tokenMaxB,
    },
  );

  instructions.push(...createInstructions);

  // Since position exists tick arrays must also already exist

  instructions.push(
    getIncreaseLiquidityInstruction({
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
      tickArrayLower,
      tickArrayUpper,
      liquidityAmount: quote.liquidityDelta,
      tokenMaxA: quote.tokenMaxA,
      tokenMaxB: quote.tokenMaxB,
      memoProgram: MEMO_PROGRAM_ADDRESS,
      remainingAccountsInfo: null,
    }),
  );

  instructions.push(...cleanupInstructions);

  return {
    quote,
    instructions,
  };
}

/**
 * Represents the instructions and quote for opening a position.
 * Extends IncreaseLiquidityInstructions with additional fields for position initialization.
 */
export type OpenPositionInstructions = IncreaseLiquidityInstructions & {
  /** The initialization cost for opening the position in lamports. */
  initializationCost: Lamports;

  /** The mint address of the position NFT. */
  positionMint: Address;
};

async function internalOpenPositionInstructions(
  rpc: Rpc<GetAccountInfoApi & GetMultipleAccountsApi & GetMinimumBalanceForRentExemptionApi & GetEpochInfoApi>,
  positionMint: TransactionSigner | Address,
  fusionPool: Account<FusionPool>,
  param: IncreaseLiquidityQuoteParam,
  lowerTickIndex: number,
  upperTickIndex: number,
  mintA: Account<Mint>,
  mintB: Account<Mint>,
  slippageToleranceBps: number,
  funder: TransactionSigner,
): Promise<OpenPositionInstructions> {
  assert(funder.address !== DEFAULT_ADDRESS, "Either supply a funder or set the default funder");
  const instructions: IInstruction[] = [];

  const positionMintAddress = typeof positionMint === "string" ? positionMint : positionMint.address;

  const rent = await fetchSysvarRent(rpc);
  let nonRefundableRent: bigint = 0n;

  const tickRange = orderTickIndexes(lowerTickIndex, upperTickIndex);

  const initializableLowerTickIndex = getInitializableTickIndex(
    tickRange.tickLowerIndex,
    fusionPool.data.tickSpacing,
    false,
  );
  const initializableUpperTickIndex = getInitializableTickIndex(
    tickRange.tickUpperIndex,
    fusionPool.data.tickSpacing,
    true,
  );

  const currentEpoch = await rpc.getEpochInfo().send();
  const transferFeeA = getCurrentTransferFee(mintA, currentEpoch.epoch);
  const transferFeeB = getCurrentTransferFee(mintB, currentEpoch.epoch);

  const quote = getIncreaseLiquidityQuote(
    param,
    fusionPool.data,
    initializableLowerTickIndex,
    initializableUpperTickIndex,
    slippageToleranceBps,
    transferFeeA,
    transferFeeB,
  );

  const lowerTickArrayIndex = getTickArrayStartTickIndex(initializableLowerTickIndex, fusionPool.data.tickSpacing);
  const upperTickArrayIndex = getTickArrayStartTickIndex(initializableUpperTickIndex, fusionPool.data.tickSpacing);

  const [positionAddress, positionTokenAccount, lowerTickArrayAddress, upperTickArrayAddress] = await Promise.all([
    getPositionAddress(positionMintAddress),
    findAssociatedTokenPda({
      owner: funder.address,
      mint: positionMintAddress,
      tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    }).then(x => x[0]),
    getTickArrayAddress(fusionPool.address, lowerTickArrayIndex).then(x => x[0]),
    getTickArrayAddress(fusionPool.address, upperTickArrayIndex).then(x => x[0]),
  ]);

  const { createInstructions, cleanupInstructions, tokenAccountAddresses } = await prepareTokenAccountsInstructions(
    rpc,
    funder,
    {
      [fusionPool.data.tokenMintA]: quote.tokenMaxA,
      [fusionPool.data.tokenMintB]: quote.tokenMaxB,
    },
  );

  instructions.push(...createInstructions);

  const [lowerTickArray, upperTickArray] = await fetchAllMaybeTickArray(rpc, [
    lowerTickArrayAddress,
    upperTickArrayAddress,
  ]);

  if (!lowerTickArray.exists) {
    instructions.push(
      getInitializeTickArrayInstruction({
        fusionPool: fusionPool.address,
        funder,
        tickArray: lowerTickArrayAddress,
        startTickIndex: lowerTickArrayIndex,
      }),
    );
    nonRefundableRent += calculateMinimumBalanceForRentExemption(rent, getTickArrayMinSize());
  }

  if (!upperTickArray.exists && lowerTickArrayIndex !== upperTickArrayIndex) {
    instructions.push(
      getInitializeTickArrayInstruction({
        fusionPool: fusionPool.address,
        funder,
        tickArray: upperTickArrayAddress,
        startTickIndex: upperTickArrayIndex,
      }),
    );
    nonRefundableRent += calculateMinimumBalanceForRentExemption(rent, getTickArrayMinSize());
  }

  if (typeof positionMint === "string") {
    instructions.push(
      getOpenPositionInstructionWithEphemeralSigner({
        funder,
        owner: funder.address,
        position: positionAddress[0],
        positionMint: positionMintAddress,
        positionTokenAccount,
        fusionPool: fusionPool.address,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
        tickLowerIndex: initializableLowerTickIndex,
        tickUpperIndex: initializableUpperTickIndex,
        token2022Program: TOKEN_2022_PROGRAM_ADDRESS,
        metadataUpdateAuth: FP_NFT_UPDATE_AUTH,
        withTokenMetadataExtension: true,
      }),
    );
  } else {
    instructions.push(
      getOpenPositionInstruction({
        funder,
        owner: funder.address,
        position: positionAddress[0],
        positionMint,
        positionTokenAccount,
        fusionPool: fusionPool.address,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
        tickLowerIndex: initializableLowerTickIndex,
        tickUpperIndex: initializableUpperTickIndex,
        token2022Program: TOKEN_2022_PROGRAM_ADDRESS,
        metadataUpdateAuth: FP_NFT_UPDATE_AUTH,
        withTokenMetadataExtension: true,
      }),
    );
  }

  instructions.push(
    getIncreaseLiquidityInstruction({
      fusionPool: fusionPool.address,
      positionAuthority: funder,
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
      tickArrayLower: lowerTickArrayAddress,
      tickArrayUpper: upperTickArrayAddress,
      liquidityAmount: quote.liquidityDelta,
      tokenMaxA: quote.tokenMaxA,
      tokenMaxB: quote.tokenMaxB,
      memoProgram: MEMO_PROGRAM_ADDRESS,
      remainingAccountsInfo: null,
    }),
  );

  instructions.push(...cleanupInstructions);

  return {
    instructions,
    quote,
    positionMint: positionMintAddress,
    initializationCost: lamports(nonRefundableRent),
  };
}

/**
 * Opens a full-range position for a pool, typically used for Splash Pools or other full-range liquidity provisioning.
 *
 * @param {Rpc<GetAccountInfoApi & GetMultipleAccountsApi & GetMinimumBalanceForRentExemptionApi & GetEpochInfoApi>} rpc - The Solana RPC client.
 * @param {TransactionSigner | Address} positionMint - Ephemeral signer keypair of a position mint generated by generateKeyPairSigner(). In the case of a multisig transaction, it may instead be a public key retrieved via a SquadsX wallet.
 * @param {Address} poolAddress - The address of the liquidity pool.
 * @param {IncreaseLiquidityQuoteParam} param - The parameters for adding liquidity, where one of `liquidity`, `tokenA`, or `tokenB` must be specified. The SDK will compute the others.
 * @param {number} [slippageToleranceBps=SLIPPAGE_TOLERANCE_BPS] - The maximum acceptable slippage, in basis points (BPS).
 * @param {TransactionSigner} [funder=FUNDER] - The account funding the transaction.
 * @returns {Promise<OpenPositionInstructions>} A promise that resolves to an object containing the instructions, quote, position mint address, and initialization costs for increasing liquidity.
 *
 * @example
 * import { openFullRangePositionInstructions, setFusionPoolsConfig } from '@crypticdot/fusionamm';
 * import { generateKeyPairSigner, createSolanaRpc, devnet, address } from '@solana/kit';
 *
 * await setFusionPoolsConfig('solanaDevnet');
 * const devnetRpc = createSolanaRpc(devnet('https://api.devnet.solana.com'));
 * const wallet = await generateKeyPairSigner(); // CAUTION: This wallet is not persistent.
 *
 * const fusionPoolAddress = address("POOL_ADDRESS");
 *
 * const param = { tokenA: 1_000_000n };
 *
 * const { quote, instructions, initializationCost, positionMint } = await openFullRangePositionInstructions(
 *   devnetRpc,
 *   fusionPoolAddress,
 *   param,
 *   100,
 *   wallet
 * );
 */
export async function openFullRangePositionInstructions(
  rpc: Rpc<GetAccountInfoApi & GetMultipleAccountsApi & GetMinimumBalanceForRentExemptionApi & GetEpochInfoApi>,
  positionMint: TransactionSigner | Address,
  poolAddress: Address,
  param: IncreaseLiquidityQuoteParam,
  slippageToleranceBps: number = SLIPPAGE_TOLERANCE_BPS,
  funder: TransactionSigner = FUNDER,
): Promise<OpenPositionInstructions> {
  const fusionPool = await fetchFusionPool(rpc, poolAddress);
  const tickRange = getFullRangeTickIndexes(fusionPool.data.tickSpacing);
  const [mintA, mintB] = await fetchAllMint(rpc, [fusionPool.data.tokenMintA, fusionPool.data.tokenMintB]);
  return internalOpenPositionInstructions(
    rpc,
    positionMint,
    fusionPool,
    param,
    tickRange.tickLowerIndex,
    tickRange.tickUpperIndex,
    mintA,
    mintB,
    slippageToleranceBps,
    funder,
  );
}

/**
 * Opens a new position in a concentrated liquidity pool within a specific price range.
 * This function allows you to provide liquidity for the specified range of prices and adjust liquidity parameters accordingly.
 *
 * @param {Rpc<GetAccountInfoApi & GetMultipleAccountsApi & GetMinimumBalanceForRentExemptionApi & GetEpochInfoApi>} rpc - A Solana RPC client used to interact with the blockchain.
 * @param {TransactionSigner | Address} positionMint - Ephemeral signer keypair of a position mint generated by generateKeyPairSigner(). In the case of a multisig transaction, it may instead be a public key retrieved via a SquadsX wallet.
 * @param {Address} poolAddress - The address of the liquidity pool where the position will be opened.
 * @param {IncreaseLiquidityQuoteParam} param - The parameters for increasing liquidity, where you must choose one (`liquidity`, `tokenA`, or `tokenB`). The SDK will compute the other two.
 * @param {number} lowerPriceOrTickIndex - The lower bound of the price range for the position.
 * @param {number} upperPriceOrTickIndex - The upper bound of the price range for the position.
 * @param {number} [slippageToleranceBps=SLIPPAGE_TOLERANCE_BPS] - The slippage tolerance for adding liquidity, in basis points (BPS).
 * @param {TransactionSigner} [funder=FUNDER] - The account funding the transaction.
 *
 * @returns {Promise<OpenPositionInstructions>} A promise that resolves to an object containing instructions, quote, position mint address, and initialization costs for increasing liquidity.
 *
 * @example
 * import { openPositionInstructions, setFusionPoolsConfig } from '@crypticdot/fusionamm';
 * import { generateKeyPairSigner, createSolanaRpc, devnet, address } from '@solana/kit';
 *
 * await setFusionPoolsConfig('solanaDevnet');
 * const devnetRpc = createSolanaRpc(devnet('https://api.devnet.solana.com'));
 * const wallet = await generateKeyPairSigner(); // CAUTION: This wallet is not persistent.
 *
 * const fusionPoolAddress = address("POOL_ADDRESS");
 *
 * const param = { tokenA: 1_000_000n };
 * const lowerPrice = 0.00005;
 * const upperPrice = 0.00015;
 *
 * const { quote, instructions, initializationCost, positionMint } = await openPositionInstructions(
 *   devnetRpc,
 *   fusionPoolAddress,
 *   param,
 *   lowerPrice,
 *   upperPrice,
 *   100,
 *   wallet
 * );
 */
export async function openPositionInstructions(
  rpc: Rpc<GetAccountInfoApi & GetMultipleAccountsApi & GetMinimumBalanceForRentExemptionApi & GetEpochInfoApi>,
  positionMint: TransactionSigner | Address,
  poolAddress: Address,
  param: IncreaseLiquidityQuoteParam,
  lowerPriceOrTickIndex: PriceOrTickIndex,
  upperPriceOrTickIndex: PriceOrTickIndex,
  slippageToleranceBps: number = SLIPPAGE_TOLERANCE_BPS,
  funder: TransactionSigner = FUNDER,
): Promise<OpenPositionInstructions> {
  const fusionPool = await fetchFusionPool(rpc, poolAddress);
  const [mintA, mintB] = await fetchAllMint(rpc, [fusionPool.data.tokenMintA, fusionPool.data.tokenMintB]);
  const decimalsA = mintA.data.decimals;
  const decimalsB = mintB.data.decimals;
  const lowerTickIndex =
    lowerPriceOrTickIndex.tickIndex ?? priceToTickIndex(lowerPriceOrTickIndex.price, decimalsA, decimalsB);
  const upperTickIndex =
    upperPriceOrTickIndex.tickIndex ?? priceToTickIndex(upperPriceOrTickIndex.price, decimalsA, decimalsB);
  return internalOpenPositionInstructions(
    rpc,
    positionMint,
    fusionPool,
    param,
    lowerTickIndex,
    upperTickIndex,
    mintA,
    mintB,
    slippageToleranceBps,
    funder,
  );
}
