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
  getIncreaseLiquidityInstruction,
  getInitializeConfigInstruction,
  getInitializePoolInstruction,
  getInitializeTickArrayInstruction,
  getOpenPositionInstruction,
  getPositionAddress,
  getTickArrayAddress,
  getTokenBadgeAddress,
  getFusionPoolAddress,
  getFusionPoolsConfigAddress,
  FP_NFT_UPDATE_AUTH,
} from "@crypticdot/fusionamm-client";
import {
  getInitializableTickIndex,
  getTickArrayStartTickIndex,
  increaseLiquidityQuote,
  tickIndexToSqrtPrice,
} from "@crypticdot/fusionamm-core";
import { MEMO_PROGRAM_ADDRESS } from "@solana-program/memo";
import {
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  fetchMint,
  findAssociatedTokenPda,
  TOKEN_2022_PROGRAM_ADDRESS,
} from "@solana-program/token-2022";
import { address, type Address, type IInstruction } from "@solana/kit";
import { getNextKeypair } from "./keypair";
import { rpc, sendTransaction, signer } from "./mockRpc";

export async function setupConfig() {
  const instructions: IInstruction[] = [];

  const fusionPoolsConfig = (await getFusionPoolsConfigAddress())[0];

  instructions.push(
    getInitializeConfigInstruction({
      fusionPoolsConfig,
      funder: signer,
      feeAuthority: signer.address,
      collectProtocolFeesAuthority: signer.address,
      tokenBadgeAuthority: signer.address,
      defaultProtocolFeeRate: 100,
    }),
  );

  await sendTransaction(instructions);
}

export async function setupFusionPool(
  tokenA: Address,
  tokenB: Address,
  tickSpacing: number,
  config: { initialSqrtPrice?: bigint } = {},
): Promise<Address> {
  const fusionPoolAddress = await getFusionPoolAddress(tokenA, tokenB, tickSpacing);
  const vaultA = getNextKeypair();
  const vaultB = getNextKeypair();
  const badgeA = await getTokenBadgeAddress(tokenA);
  const badgeB = await getTokenBadgeAddress(tokenB);
  const mintA = await fetchMint(rpc, tokenA);
  const mintB = await fetchMint(rpc, tokenB);
  const programA = mintA.programAddress;
  const programB = mintB.programAddress;

  const sqrtPrice = config.initialSqrtPrice ?? tickIndexToSqrtPrice(0);

  const instructions: IInstruction[] = [];

  // The default fixed value for tests.
  const feeRate = tickSpacing == 64 ? 300 : 1000;

  instructions.push(
    getInitializePoolInstruction({
      fusionPool: fusionPoolAddress[0],
      tokenMintA: tokenA,
      tokenMintB: tokenB,
      tickSpacing,
      feeRate,
      fusionPoolsConfig: (await getFusionPoolsConfigAddress())[0],
      funder: signer,
      tokenVaultA: vaultA,
      tokenVaultB: vaultB,
      tokenBadgeA: badgeA[0],
      tokenBadgeB: badgeB[0],
      tokenProgramA: programA,
      tokenProgramB: programB,
      initialSqrtPrice: sqrtPrice,
    }),
  );

  await sendTransaction(instructions);
  return fusionPoolAddress[0];
}

export async function setupPosition(
  fusionPool: Address,
  config: { tickLower?: number; tickUpper?: number; liquidity?: bigint } = {},
): Promise<Address> {
  const positionMint = getNextKeypair();
  const fusionPoolAccount = await fetchFusionPool(rpc, fusionPool);
  const tickLower = config.tickLower ?? -100;
  const tickUpper = config.tickUpper ?? 100;

  const initializableLowerTickIndex = getInitializableTickIndex(tickLower, fusionPoolAccount.data.tickSpacing, false);
  const initializableUpperTickIndex = getInitializableTickIndex(tickUpper, fusionPoolAccount.data.tickSpacing, true);

  const lowerTickArrayIndex = getTickArrayStartTickIndex(
    initializableLowerTickIndex,
    fusionPoolAccount.data.tickSpacing,
  );
  const upperTickArrayIndex = getTickArrayStartTickIndex(
    initializableUpperTickIndex,
    fusionPoolAccount.data.tickSpacing,
  );

  const [positionAddress, positionTokenAccount, lowerTickArrayAddress, upperTickArrayAddress] = await Promise.all([
    getPositionAddress(positionMint.address),
    findAssociatedTokenPda({
      owner: signer.address,
      mint: positionMint.address,
      tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    }).then(x => x[0]),
    getTickArrayAddress(fusionPool, lowerTickArrayIndex).then(x => x[0]),
    getTickArrayAddress(fusionPool, upperTickArrayIndex).then(x => x[0]),
  ]);

  const [lowerTickArray, upperTickArray] = await fetchAllMaybeTickArray(rpc, [
    lowerTickArrayAddress,
    upperTickArrayAddress,
  ]);

  const instructions: IInstruction[] = [];

  if (!lowerTickArray.exists) {
    instructions.push(
      getInitializeTickArrayInstruction({
        fusionPool: fusionPool,
        funder: signer,
        tickArray: lowerTickArrayAddress,
        startTickIndex: lowerTickArrayIndex,
      }),
    );
  }

  if (!upperTickArray.exists && lowerTickArrayIndex !== upperTickArrayIndex) {
    instructions.push(
      getInitializeTickArrayInstruction({
        fusionPool: fusionPool,
        funder: signer,
        tickArray: upperTickArrayAddress,
        startTickIndex: upperTickArrayIndex,
      }),
    );
  }

  instructions.push(
    getOpenPositionInstruction({
      funder: signer,
      owner: signer.address,
      position: positionAddress[0],
      positionMint: positionMint,
      positionTokenAccount: positionTokenAccount,
      fusionPool: fusionPool,
      token2022Program: TOKEN_2022_PROGRAM_ADDRESS,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
      metadataUpdateAuth: FP_NFT_UPDATE_AUTH,
      tickLowerIndex: initializableLowerTickIndex,
      tickUpperIndex: initializableUpperTickIndex,
      withTokenMetadataExtension: true,
    }),
  );

  if (config.liquidity) {
    const tokenMintA = await fetchMint(rpc, fusionPoolAccount.data.tokenMintA);
    const tokenOwnerAccountA = await findAssociatedTokenPda({
      owner: signer.address,
      mint: fusionPoolAccount.data.tokenMintA,
      tokenProgram: tokenMintA.programAddress,
    }).then(x => x[0]);

    const tokenMintB = await fetchMint(rpc, fusionPoolAccount.data.tokenMintB);
    const tokenOwnerAccountB = await findAssociatedTokenPda({
      owner: signer.address,
      mint: fusionPoolAccount.data.tokenMintB,
      tokenProgram: tokenMintB.programAddress,
    }).then(x => x[0]);

    const quote = increaseLiquidityQuote(
      config.liquidity,
      100,
      fusionPoolAccount.data.sqrtPrice,
      initializableLowerTickIndex,
      initializableUpperTickIndex,
    );

    instructions.push(
      getIncreaseLiquidityInstruction({
        fusionPool: fusionPool,
        positionAuthority: signer,
        position: positionAddress[0],
        positionTokenAccount,
        tokenOwnerAccountA: tokenOwnerAccountA,
        tokenOwnerAccountB: tokenOwnerAccountB,
        tokenVaultA: fusionPoolAccount.data.tokenVaultA,
        tokenVaultB: fusionPoolAccount.data.tokenVaultB,
        tokenMintA: fusionPoolAccount.data.tokenMintA,
        tokenMintB: fusionPoolAccount.data.tokenMintB,
        tokenProgramA: tokenMintA.programAddress,
        tokenProgramB: tokenMintB.programAddress,
        tickArrayLower: lowerTickArrayAddress,
        tickArrayUpper: upperTickArrayAddress,
        liquidityAmount: quote.liquidityDelta,
        tokenMaxA: quote.tokenMaxA,
        tokenMaxB: quote.tokenMaxB,
        memoProgram: MEMO_PROGRAM_ADDRESS,
        remainingAccountsInfo: null,
      }),
    );
  }

  await sendTransaction(instructions);

  return positionMint.address;
}

export async function setupPositionBundle(
  fusionPool: Address,
  config: { tickLower?: number; tickUpper?: number; liquidity?: bigint }[] = [],
): Promise<Address> {
  // TODO: implement when solana-bankrun supports gpa
  const _ = config;
  return fusionPool;
}
