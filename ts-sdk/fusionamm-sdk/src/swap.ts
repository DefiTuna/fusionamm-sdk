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
  Account,
  Address,
  GetAccountInfoApi,
  GetEpochInfoApi,
  GetMinimumBalanceForRentExemptionApi,
  GetMultipleAccountsApi,
  IInstruction,
  Rpc,
  TransactionSigner,
} from "@solana/kit";
import {AccountRole, lamports} from "@solana/kit";
import {FUNDER, SLIPPAGE_TOLERANCE_BPS} from "./config";
import type {ExactInSwapQuote, ExactOutSwapQuote, TickArrayFacade, TransferFee} from "@crypticdot/fusionamm-core";
import {
  _TICK_ARRAY_SIZE,
  getTickArrayStartTickIndex,
  swapQuoteByInputToken,
  swapQuoteByOutputToken,
} from "@crypticdot/fusionamm-core";
import type {FusionPool} from "@crypticdot/fusionamm-client";
import {
  AccountsType,
  fetchAllMaybeTickArray,
  fetchFusionPool,
  getSwapInstruction,
  getTickArrayAddress,
} from "@crypticdot/fusionamm-client";
import {getCurrentTransferFee, prepareTokenAccountsInstructions} from "./token";
import {MEMO_PROGRAM_ADDRESS} from "@solana-program/memo";
import {fetchAllMint} from "@solana-program/token-2022";

// TODO: allow specify number as well as bigint
// TODO: transfer hook

/**
 * Parameters for an exact input swap.
 */
export type ExactInParams = {
  /** The exact amount of input tokens to be swapped. */
  inputAmount: bigint;
};

/**
 * Parameters for an exact output swap.
 */
export type ExactOutParams = {
  /** The exact amount of output tokens to be received from the swap. */
  outputAmount: bigint;
};

/**
 * Swap parameters, either for an exact input or exact output swap.
 */
export type SwapParams = (ExactInParams | ExactOutParams) & {
  /** The mint address of the token being swapped. */
  mint: Address;
};

/**
 * Swap quote that corresponds to the type of swap being executed (either input or output swap).
 *
 * @template T - The type of swap (input or output).
 */
export type SwapQuote<T extends SwapParams> = T extends ExactInParams ? ExactInSwapQuote : ExactOutSwapQuote;

/**
 * Instructions and quote for executing a swap.
 *
 * @template T - The type of swap (input or output).
 */
export type SwapInstructions<T extends SwapParams> = {
  /** The list of instructions needed to perform the swap. */
  instructions: IInstruction[];

  /** The swap quote, which includes information about the amounts involved in the swap. */
  quote: SwapQuote<T>;
};

function createUninitializedTickArray(
  address: Address,
  startTickIndex: number,
  programAddress: Address,
): Account<TickArrayFacade> {
  return {
    address,
    data: {
      startTickIndex,
      ticks: Array(_TICK_ARRAY_SIZE()).fill({
        initialized: false,
        liquidityNet: 0n,
        liquidityGross: 0n,
        feeGrowthOutsideA: 0n,
        feeGrowthOutsideB: 0n,
        age: 0n,
        openOrdersInput: 0n,
        partFilledOrdersInput: 0n,
        partFilledOrdersRemainingInput: 0n,
        fulfilledAToBOrdersInput: 0n,
        fulfilledBToAOrdersInput: 0n,
      }),
    },
    space: 0n,
    executable: false,
    lamports: lamports(0n),
    programAddress,
  };
}

export async function fetchTickArrayOrDefault(
  rpc: Rpc<GetMultipleAccountsApi>,
  fusionPool: Account<FusionPool>,
): Promise<Account<TickArrayFacade>[]> {
  const tickArrayStartIndex = getTickArrayStartTickIndex(fusionPool.data.tickCurrentIndex, fusionPool.data.tickSpacing);
  const offset = fusionPool.data.tickSpacing * _TICK_ARRAY_SIZE();

  const tickArrayIndexes = [
    tickArrayStartIndex,
    tickArrayStartIndex + offset,
    tickArrayStartIndex + offset * 2,
    tickArrayStartIndex - offset,
    tickArrayStartIndex - offset * 2,
  ];

  const tickArrayAddresses = await Promise.all(
    tickArrayIndexes.map(startIndex => getTickArrayAddress(fusionPool.address, startIndex).then(x => x[0])),
  );

  const maybeTickArrays = await fetchAllMaybeTickArray(rpc, tickArrayAddresses);

  const tickArrays: Account<TickArrayFacade>[] = [];

  for (let i = 0; i < maybeTickArrays.length; i++) {
    const maybeTickArray = maybeTickArrays[i];
    if (maybeTickArray.exists) {
      tickArrays.push(maybeTickArray);
    } else {
      tickArrays.push(
        createUninitializedTickArray(tickArrayAddresses[i], tickArrayIndexes[i], fusionPool.programAddress),
      );
    }
  }

  return tickArrays;
}

function getSwapQuote<T extends SwapParams>(
  params: T,
  fusionPool: FusionPool,
  transferFeeA: TransferFee | undefined,
  transferFeeB: TransferFee | undefined,
  tickArrays: TickArrayFacade[],
  specifiedTokenA: boolean,
  slippageToleranceBps: number,
): SwapQuote<T> {
  if ("inputAmount" in params) {
    return swapQuoteByInputToken(
      params.inputAmount,
      specifiedTokenA,
      slippageToleranceBps,
      fusionPool,
      tickArrays,
      transferFeeA,
      transferFeeB,
    ) as SwapQuote<T>;
  }

  return swapQuoteByOutputToken(
    params.outputAmount,
    specifiedTokenA,
    slippageToleranceBps,
    fusionPool,
    tickArrays,
    transferFeeA,
    transferFeeB,
  ) as SwapQuote<T>;
}

/**
 * Generates the instructions necessary to execute a token swap in a Fusion Pool.
 * It handles both exact input and exact output swaps, fetching the required accounts, tick arrays, and determining the swap quote.
 *
 * @template T - The type of swap (exact input or output).
 * @param {SolanaRpc} rpc - The Solana RPC client.
 * @param {T} params - The swap parameters, specifying either the input or output amount and the mint address of the token being swapped.
 * @param {Address} poolAddress - The address of the FusionPool against which the swap will be made.
 * @param {number} [slippageToleranceBps=SLIPPAGE_TOLERANCE_BPS] - The maximum acceptable slippage tolerance for the swap, in basis points (BPS).
 * @param {TransactionSigner} [signer=FUNDER] - The wallet or signer executing the swap.
 * @returns {Promise<SwapInstructions<T>>} - A promise that resolves to an object containing the swap instructions and the swap quote.
 *
 * @example
 * import { setFusionPoolsConfig, swapInstructions } from '@crypticdot/fusionamm';
 * import { createSolanaRpc, devnet, address } from '@solana/kit';
 * import { loadWallet } from './utils';
 *
 * await setFusionPoolsConfig('solanaDevnet');
 * const devnetRpc = createSolanaRpc(devnet('https://api.devnet.solana.com'));
 * const wallet = await loadWallet(); // CAUTION: This wallet is not persistent.
 * const fusionPoolAddress = address("3KBZiL2g8C7tiJ32hTv5v3KM7aK9htpqTw4cTXz1HvPt");
 * const mintAddress = address("BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k");
 * const inputAmount = 1_000_000n;
 *
 * const { instructions, quote } = await swapInstructions(
 *   devnetRpc,
 *   { inputAmount, mint: mintAddress },
 *   fusionPoolAddress,
 *   100,
 *   wallet
 * );
 *
 * console.log(`Quote estimated token out: ${quote.tokenEstOut}`);
 * console.log(`Number of instructions:, ${instructions.length}`);
 */
export async function swapInstructions<T extends SwapParams>(
  rpc: Rpc<GetAccountInfoApi & GetMultipleAccountsApi & GetMinimumBalanceForRentExemptionApi & GetEpochInfoApi>,
  params: T,
  poolAddress: Address,
  slippageToleranceBps: number = SLIPPAGE_TOLERANCE_BPS,
  signer: TransactionSigner = FUNDER,
): Promise<SwapInstructions<T>> {
  const fusionPool = await fetchFusionPool(rpc, poolAddress);
  const [tokenA, tokenB] = await fetchAllMint(rpc, [fusionPool.data.tokenMintA, fusionPool.data.tokenMintB]);
  const specifiedTokenA = params.mint === fusionPool.data.tokenMintA;
  const specifiedInput = "inputAmount" in params;

  const tickArrays = await fetchTickArrayOrDefault(rpc, fusionPool);

  const currentEpoch = await rpc.getEpochInfo().send();
  const transferFeeA = getCurrentTransferFee(tokenA, currentEpoch.epoch);
  const transferFeeB = getCurrentTransferFee(tokenB, currentEpoch.epoch);

  const quote = getSwapQuote<T>(
    params,
    fusionPool.data,
    transferFeeA,
    transferFeeB,
    tickArrays.map(x => x.data),
    specifiedTokenA,
    slippageToleranceBps,
  );
  const maxInAmount = "tokenIn" in quote ? quote.tokenIn : quote.tokenMaxIn;
  const aToB = specifiedTokenA === specifiedInput;

  const {createInstructions, cleanupInstructions, tokenAccountAddresses} = await prepareTokenAccountsInstructions(
    rpc,
    signer,
    {
      [fusionPool.data.tokenMintA]: aToB ? maxInAmount : 0n,
      [fusionPool.data.tokenMintB]: aToB ? 0n : maxInAmount,
    },
  );

  const instructions: IInstruction[] = [];

  instructions.push(...createInstructions);

  const specifiedAmount = "inputAmount" in params ? params.inputAmount : params.outputAmount;
  const otherAmountThreshold = "tokenMaxIn" in quote ? quote.tokenMaxIn : quote.tokenMinOut;

  const swapInstruction = getSwapInstruction({
    tokenProgramA: tokenA.programAddress,
    tokenProgramB: tokenB.programAddress,
    memoProgram: MEMO_PROGRAM_ADDRESS,
    tokenAuthority: signer,
    fusionPool: fusionPool.address,
    tokenMintA: fusionPool.data.tokenMintA,
    tokenMintB: fusionPool.data.tokenMintB,
    tokenOwnerAccountA: tokenAccountAddresses[fusionPool.data.tokenMintA],
    tokenOwnerAccountB: tokenAccountAddresses[fusionPool.data.tokenMintB],
    tokenVaultA: fusionPool.data.tokenVaultA,
    tokenVaultB: fusionPool.data.tokenVaultB,
    tickArray0: tickArrays[0].address,
    tickArray1: tickArrays[1].address,
    tickArray2: tickArrays[2].address,
    amount: specifiedAmount,
    otherAmountThreshold,
    sqrtPriceLimit: 0,
    amountSpecifiedIsInput: specifiedInput,
    aToB,
    remainingAccountsInfo: {
      slices: [{accountsType: AccountsType.SupplementalTickArrays, length: 2}],
    },
  });

  swapInstruction.accounts.push(
    {address: tickArrays[3].address, role: AccountRole.WRITABLE},
    {address: tickArrays[4].address, role: AccountRole.WRITABLE},
  );

  instructions.push(swapInstruction);
  instructions.push(...cleanupInstructions);

  return {
    quote,
    instructions,
  };
}
