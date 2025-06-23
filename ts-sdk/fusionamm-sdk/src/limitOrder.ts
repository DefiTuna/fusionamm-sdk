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
  fetchAllLimitOrderWithFilter,
  fetchAllMaybeLimitOrder,
  fetchLimitOrder,
  fetchMaybeTickArray,
  getCloseLimitOrderInstruction,
  LimitOrder,
  limitOrderFusionPoolFilter,
} from "@crypticdot/fusionamm-client";
import {
  fetchFusionPool,
  getInitializeTickArrayInstruction,
  getDecreaseLimitOrderInstruction,
  getIncreaseLimitOrderInstruction,
  getOpenLimitOrderInstruction,
  getLimitOrderAddress,
  getTickArrayAddress,
  getTickArraySize,
} from "@crypticdot/fusionamm-client";
import {
  getTickArrayStartTickIndex,
  priceToTickIndex,
  getInitializableTickIndex,
  tryReverseApplyTransferFee,
  tryApplyTransferFee,
} from "@crypticdot/fusionamm-core";
import {
  Account,
  Address,
  GetAccountInfoApi,
  getBase64Encoder,
  GetEpochInfoApi,
  GetMinimumBalanceForRentExemptionApi,
  GetMultipleAccountsApi,
  GetProgramAccountsApi,
  GetTokenAccountsByOwnerApi,
  IInstruction,
  Lamports,
  Rpc,
  TransactionSigner,
} from "@solana/kit";
import { generateKeyPairSigner, lamports } from "@solana/kit";
import { fetchSysvarRent } from "@solana/sysvars";
import { DEFAULT_ADDRESS, FUNDER } from "./config";
import { ASSOCIATED_TOKEN_PROGRAM_ADDRESS, findAssociatedTokenPda, getTokenDecoder } from "@solana-program/token";
import { getCurrentTransferFee, prepareTokenAccountsInstructions } from "./token";
import { fetchAllMint, TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import { MEMO_PROGRAM_ADDRESS } from "@solana-program/memo";
import assert from "assert";
import { calculateMinimumBalanceForRentExemption } from "./sysvar";
import { PriceOrTickIndex } from "./types";

export type IncreaseLimitOrderInstructions = {
  /** List of Solana transaction instructions to execute. */
  instructions: IInstruction[];
  /** The amount of transferred tokens including transfer fees. */
  amountWithFee: bigint;
};

export type OpenLimitOrderInstructions = IncreaseLimitOrderInstructions & {
  /** The initialization cost for opening the limit order in lamports. */
  initializationCost: Lamports;
  /** The mint address of the limit order NFT. */
  limitOrderMint: Address;
};

export type DecreaseLimitOrderInstructions = {
  /** List of Solana transaction instructions to execute. */
  instructions: IInstruction[];
};

/**
 * Opens a new limit order in a concentrated liquidity pool at a specific price.
 *
 * @param {SolanaRpc} rpc - A Solana RPC client used to interact with the blockchain.
 * @param {Address} poolAddress - The address of the liquidity pool where the position will be opened.
 * @param {boolean} aToB - The limit order swap direction.
 * @param {bigint} amount - Amount of the input token.
 * @param {number} priceOrTickIndex - Limit order price or tick index.
 * @param {TransactionSigner} [funder=FUNDER] - The account funding the transaction.
 *
 * @returns {Promise<OpenLimitOrderInstructions>} A promise that resolves to an object containing instructions, limit order mint address, and initialization costs for adding a limit order.
 *
 */
export async function openLimitOrderInstructions(
  rpc: Rpc<GetAccountInfoApi & GetMultipleAccountsApi & GetMinimumBalanceForRentExemptionApi & GetEpochInfoApi>,
  poolAddress: Address,
  amount: bigint,
  priceOrTickIndex: PriceOrTickIndex,
  aToB: boolean,
  funder: TransactionSigner = FUNDER,
): Promise<OpenLimitOrderInstructions> {
  assert(funder.address !== DEFAULT_ADDRESS, "Either supply a funder or set the default funder");

  const fusionPool = await fetchFusionPool(rpc, poolAddress);
  const [mintA, mintB] = await fetchAllMint(rpc, [fusionPool.data.tokenMintA, fusionPool.data.tokenMintB]);
  const decimalsA = mintA.data.decimals;
  const decimalsB = mintB.data.decimals;
  const tickIndex = priceOrTickIndex.tickIndex ?? priceToTickIndex(priceOrTickIndex.price, decimalsA, decimalsB);

  const mint = aToB ? mintA : mintB;

  const instructions: IInstruction[] = [];

  const rent = await fetchSysvarRent(rpc);
  let nonRefundableRent: bigint = 0n;

  const initializableTickIndex = getInitializableTickIndex(tickIndex, fusionPool.data.tickSpacing, false);

  const currentEpoch = await rpc.getEpochInfo().send();
  const transferFee = getCurrentTransferFee(mint, currentEpoch.epoch);

  const amountWithFee = transferFee ? tryReverseApplyTransferFee(amount, transferFee) : amount;

  const limitOrderMint = await generateKeyPairSigner();

  const tickArrayStartIndex = getTickArrayStartTickIndex(initializableTickIndex, fusionPool.data.tickSpacing);

  const [limitOrderAddress, limitOrderTokenAccount, tickArrayAddress] = await Promise.all([
    getLimitOrderAddress(limitOrderMint.address),
    findAssociatedTokenPda({
      owner: funder.address,
      mint: limitOrderMint.address,
      tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    }).then(x => x[0]),
    getTickArrayAddress(fusionPool.address, tickArrayStartIndex).then(x => x[0]),
  ]);

  const { createInstructions, cleanupInstructions, tokenAccountAddresses } = await prepareTokenAccountsInstructions(
    rpc,
    funder,
    {
      [mint.address]: amountWithFee,
    },
  );

  instructions.push(...createInstructions);

  const tickArray = await fetchMaybeTickArray(rpc, tickArrayAddress);

  if (!tickArray.exists) {
    instructions.push(
      getInitializeTickArrayInstruction({
        fusionPool: fusionPool.address,
        funder,
        tickArray: tickArrayAddress,
        startTickIndex: tickArrayStartIndex,
      }),
    );
    nonRefundableRent += calculateMinimumBalanceForRentExemption(rent, getTickArraySize());
  }

  instructions.push(
    getOpenLimitOrderInstruction({
      funder,
      owner: funder.address,
      limitOrder: limitOrderAddress[0],
      limitOrderMint,
      limitOrderTokenAccount,
      fusionPool: fusionPool.address,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
      token2022Program: TOKEN_2022_PROGRAM_ADDRESS,
      tickIndex: initializableTickIndex,
      aToB,
    }),
  );

  instructions.push(
    getIncreaseLimitOrderInstruction({
      limitOrderAuthority: funder,
      fusionPool: fusionPool.address,
      limitOrder: limitOrderAddress[0],
      limitOrderTokenAccount,
      tokenMint: mint.address,
      tokenOwnerAccount: tokenAccountAddresses[mint.address],
      tokenVault: aToB ? fusionPool.data.tokenVaultA : fusionPool.data.tokenVaultB,
      tickArray: tickArrayAddress,
      tokenProgram: mint.programAddress,
      memoProgram: MEMO_PROGRAM_ADDRESS,
      remainingAccountsInfo: null,
      amount,
    }),
  );

  instructions.push(...cleanupInstructions);

  return {
    instructions,
    limitOrderMint: limitOrderMint.address,
    initializationCost: lamports(nonRefundableRent),
    amountWithFee,
  };
}

/**
 * Increases an existing limit order in a concentrated liquidity pool.
 *
 * @param {SolanaRpc} rpc - A Solana RPC client used to interact with the blockchain.
 * @param {Address} limitOrderMint - The mint address of the NFT that represents ownership of the limit order to be closed.
 * @param {bigint} amount - Amount of the input token.
 * @param {TransactionSigner} [authority=FUNDER] - The account authorizing the transaction.
 *
 * @returns {Promise<IncreaseLimitOrderInstructions>} A promise that resolves to an object containing instructions to increase the limit order.
 *
 */
export async function increaseLimitOrderInstructions(
  rpc: Rpc<GetAccountInfoApi & GetMultipleAccountsApi & GetMinimumBalanceForRentExemptionApi & GetEpochInfoApi>,
  limitOrderMint: Address,
  amount: bigint,
  authority: TransactionSigner = FUNDER,
): Promise<IncreaseLimitOrderInstructions> {
  assert(authority.address !== DEFAULT_ADDRESS, "Either supply a funder or set the default funder");

  const limitOrderAddress = await getLimitOrderAddress(limitOrderMint);
  const limitOrder = await fetchLimitOrder(rpc, limitOrderAddress[0]);
  const fusionPool = await fetchFusionPool(rpc, limitOrder.data.fusionPool);
  const [mintA, mintB] = await fetchAllMint(rpc, [fusionPool.data.tokenMintA, fusionPool.data.tokenMintB]);

  const aToB = limitOrder.data.aToB;
  const tickIndex = limitOrder.data.tickIndex;

  const mint = aToB ? mintA : mintB;

  const instructions: IInstruction[] = [];

  const initializableTickIndex = getInitializableTickIndex(tickIndex, fusionPool.data.tickSpacing, false);

  const currentEpoch = await rpc.getEpochInfo().send();
  const transferFee = getCurrentTransferFee(mint, currentEpoch.epoch);

  const amountWithFee = transferFee ? tryReverseApplyTransferFee(amount, transferFee) : amount;

  const tickArrayIndex = getTickArrayStartTickIndex(initializableTickIndex, fusionPool.data.tickSpacing);

  const [limitOrderTokenAccount, tickArrayAddress] = await Promise.all([
    findAssociatedTokenPda({
      owner: authority.address,
      mint: limitOrderMint,
      tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    }).then(x => x[0]),
    getTickArrayAddress(fusionPool.address, tickArrayIndex).then(x => x[0]),
  ]);

  const { createInstructions, cleanupInstructions, tokenAccountAddresses } = await prepareTokenAccountsInstructions(
    rpc,
    authority,
    {
      [mint.address]: amount,
    },
  );

  instructions.push(...createInstructions);

  instructions.push(
    getIncreaseLimitOrderInstruction({
      limitOrderAuthority: authority,
      fusionPool: fusionPool.address,
      limitOrder: limitOrderAddress[0],
      limitOrderTokenAccount,
      tokenMint: mint.address,
      tokenOwnerAccount: tokenAccountAddresses[mint.address],
      tokenVault: aToB ? fusionPool.data.tokenVaultA : fusionPool.data.tokenVaultB,
      tickArray: tickArrayAddress,
      tokenProgram: mint.programAddress,
      memoProgram: MEMO_PROGRAM_ADDRESS,
      remainingAccountsInfo: null,
      amount,
    }),
  );

  instructions.push(...cleanupInstructions);

  return {
    instructions,
    amountWithFee,
  };
}

async function decreaseAndCloseLimitOrderInstructionsInternal(
  rpc: Rpc<GetAccountInfoApi & GetMultipleAccountsApi & GetMinimumBalanceForRentExemptionApi & GetEpochInfoApi>,
  limitOrderMint: Address,
  amount?: bigint,
  authority: TransactionSigner = FUNDER,
): Promise<DecreaseLimitOrderInstructions> {
  assert(authority.address !== DEFAULT_ADDRESS, "Either supply a funder or set the default funder");

  const limitOrderAddress = await getLimitOrderAddress(limitOrderMint);
  const limitOrder = await fetchLimitOrder(rpc, limitOrderAddress[0]);
  const fusionPool = await fetchFusionPool(rpc, limitOrder.data.fusionPool);

  const [mintA, mintB] = await fetchAllMint(rpc, [fusionPool.data.tokenMintA, fusionPool.data.tokenMintB]);

  const instructions: IInstruction[] = [];

  const tickArrayIndex = getTickArrayStartTickIndex(limitOrder.data.tickIndex, fusionPool.data.tickSpacing);

  const limitOrderTokenAccount = (
    await findAssociatedTokenPda({
      owner: authority.address,
      mint: limitOrderMint,
      tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    })
  )[0];
  const tickArrayAddress = (await getTickArrayAddress(fusionPool.address, tickArrayIndex))[0];

  const { createInstructions, cleanupInstructions, tokenAccountAddresses } = await prepareTokenAccountsInstructions(
    rpc,
    authority,
    [mintA.address, mintB.address],
  );

  instructions.push(...createInstructions);

  instructions.push(
    getDecreaseLimitOrderInstruction({
      limitOrderAuthority: authority,
      fusionPool: fusionPool.address,
      limitOrder: limitOrder.address,
      limitOrderTokenAccount,
      tokenMintA: mintA.address,
      tokenMintB: mintB.address,
      tokenOwnerAccountA: tokenAccountAddresses[mintA.address],
      tokenOwnerAccountB: tokenAccountAddresses[mintB.address],
      tokenVaultA: fusionPool.data.tokenVaultA,
      tokenVaultB: fusionPool.data.tokenVaultB,
      tickArray: tickArrayAddress,
      tokenProgramA: mintA.programAddress,
      tokenProgramB: mintB.programAddress,
      memoProgram: MEMO_PROGRAM_ADDRESS,
      remainingAccountsInfo: null,
      amount: amount ?? limitOrder.data.amount,
    }),
  );

  if (amount === undefined) {
    instructions.push(
      getCloseLimitOrderInstruction({
        limitOrderAuthority: authority,
        receiver: authority.address,
        limitOrder: limitOrder.address,
        limitOrderMint,
        limitOrderTokenAccount,
        token2022Program: TOKEN_2022_PROGRAM_ADDRESS,
      }),
    );
  }

  instructions.push(...cleanupInstructions);

  return { instructions };
}

/**
 * Close the existing limit order in a concentrated liquidity pool at a specific price.
 *
 * @param {SolanaRpc} rpc - A Solana RPC client used to interact with the blockchain.
 * @param {Address} limitOrderMint - The mint address of the NFT that represents ownership of the limit order to be closed.
 * @param {TransactionSigner} [authority=FUNDER] - The account authorizing the transaction.
 *
 * @returns {Promise<OpenLimitOrderInstructions>} A promise that resolves to an object containing instructions to close the limit order.
 *
 */
export async function closeLimitOrderInstructions(
  rpc: Rpc<GetAccountInfoApi & GetMultipleAccountsApi & GetMinimumBalanceForRentExemptionApi & GetEpochInfoApi>,
  limitOrderMint: Address,
  authority: TransactionSigner = FUNDER,
): Promise<DecreaseLimitOrderInstructions> {
  return decreaseAndCloseLimitOrderInstructionsInternal(rpc, limitOrderMint, undefined, authority);
}

/**
 * Decrease the existing limit order in a concentrated liquidity pool.
 * Both input and output tokens are removed proportionally.
 *
 * @param {SolanaRpc} rpc - A Solana RPC client used to interact with the blockchain.
 * @param {Address} limitOrderMint - The mint address of the NFT that represents ownership of the limit order to be closed.
 * @param {bigint} amount - The share by which the limit order needs to be reduced.
 * @param {TransactionSigner} [authority=FUNDER] - The account authorizing the transaction.
 *
 * @returns {Promise<OpenLimitOrderInstructions>} A promise that resolves to an object containing instructions to decrease the limit order.
 *
 */
export async function decreaseLimitOrderInstructions(
  rpc: Rpc<GetAccountInfoApi & GetMultipleAccountsApi & GetMinimumBalanceForRentExemptionApi & GetEpochInfoApi>,
  limitOrderMint: Address,
  amount: bigint,
  authority: TransactionSigner = FUNDER,
): Promise<DecreaseLimitOrderInstructions> {
  return decreaseAndCloseLimitOrderInstructionsInternal(rpc, limitOrderMint, amount, authority);
}

/**
 * Fetches all limit orders owned by a given wallet in Fusion pool.
 * It looks for token accounts owned by the wallet using TOKEN_2022_PROGRAM_ADDRESS.
 * For token accounts holding exactly 1 token (indicating a position or bundle), it fetches the corresponding position addresses,
 * decodes the accounts, and returns an array of position or bundle data.
 *
 * @param {SolanaRpc} rpc - The Solana RPC client used to fetch token accounts and multiple accounts.
 * @param {Address} owner - The wallet address whose positions you want to fetch.
 * @returns {Promise<LimitOrder[]>} - A promise that resolves to an array of decoded position data for the given owner.
 */
export async function fetchLimitOrdersForOwner(
  rpc: Rpc<GetTokenAccountsByOwnerApi & GetMultipleAccountsApi>,
  owner: Address,
): Promise<Account<LimitOrder>[]> {
  const token2022Accounts = await rpc
    .getTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ADDRESS }, { encoding: "base64" })
    .send();

  const encoder = getBase64Encoder();
  const decoder = getTokenDecoder();

  const potentialTokens = [...token2022Accounts.value]
    .map(x => ({ ...decoder.decode(encoder.encode(x.account.data[0])) }))
    .filter(x => x.amount === 1n);

  const limitOrderAddresses = await Promise.all(potentialTokens.map(x => getLimitOrderAddress(x.mint).then(x => x[0])));
  return (await fetchAllMaybeLimitOrder(rpc, limitOrderAddresses)).filter(o => o.exists);
}

/**
 * Fetches all limit orders for a given FusionPool.
 *
 * @param {SolanaRpc} rpc - The Solana RPC client used to fetch positions.
 * @param {Address} fusionPool - The address of the FusionPool.
 * @returns {Promise<LimitOrder[]>} - A promise that resolves to an array of hydrated positions.
 */
export async function fetchLimitOrdersInFusionPool(
  rpc: Rpc<GetProgramAccountsApi>,
  fusionPool: Address,
): Promise<Account<LimitOrder>[]> {
  return fetchAllLimitOrderWithFilter(rpc, limitOrderFusionPoolFilter(fusionPool));
}
