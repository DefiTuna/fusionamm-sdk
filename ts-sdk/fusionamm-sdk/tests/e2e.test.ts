//
// Copyright (c) Cryptic Dot
//
// Modification based on Orca Whirlpools (https://github.com/orca-so/whirlpools),
// originally licensed under the Apache License, Version 2.0, prior to February 26, 2025.
//
// Modifications licensed under FusionAMM SDK Source-Available License v1.0
// See the LICENSE file in the project root for license information.
//

import { fetchFusionPool, fetchPosition, getPositionAddress } from "@crypticdot/fusionamm-client";
import { Address, generateKeyPairSigner } from "@solana/kit";
import { fetchToken } from "@solana-program/token";
import assert from "assert";
import { beforeAll, describe, it } from "vitest";

import {
  closePositionInstructions,
  createFusionPoolInstructions,
  decreaseLiquidityInstructions,
  harvestPositionInstructions,
  increaseLiquidityInstructions,
  openFullRangePositionInstructions,
  swapInstructions,
} from "../src";

import { rpc, sendTransaction } from "./utils/mockRpc";
import { setupAta, setupMint } from "./utils/token";

describe("e2e", () => {
  let mintA: Address;
  let mintB: Address;
  let ataA: Address;
  let ataB: Address;

  beforeAll(async () => {
    mintA = await setupMint({ decimals: 9 });
    mintB = await setupMint({ decimals: 6 });
    ataA = await setupAta(mintA, { amount: 500e9 });
    ataB = await setupAta(mintB, { amount: 500e9 });
  });

  const fetchPositionByMint = async (positionMint: Address) => {
    const positionAddress = await getPositionAddress(positionMint);
    return await fetchPosition(rpc, positionAddress[0]);
  };

  const testInitConcentratedLiquidityPool = async () => {
    const { instructions: createPoolInstructions, poolAddress } = await createFusionPoolInstructions(
      rpc,
      mintA,
      mintB,
      128,
      300,
    );
    await sendTransaction(createPoolInstructions);

    const pool = await fetchFusionPool(rpc, poolAddress);
    assert.strictEqual(pool.data.tokenMintA, mintA);
    assert.strictEqual(pool.data.tokenMintB, mintB);
    assert.strictEqual(pool.data.tickSpacing, 128);
    assert.strictEqual(pool.data.feeRate, 300);

    return poolAddress;
  };

  const testOpenPosition = async (poolAddress: Address) => {
    const tokenABefore = await fetchToken(rpc, ataA);
    const tokenBBefore = await fetchToken(rpc, ataB);

    const { instructions, positionMint, quote } = await openFullRangePositionInstructions(
      rpc,
      await generateKeyPairSigner(),
      poolAddress,
      {
        liquidity: 1000000000n,
      },
    );
    await sendTransaction(instructions);

    const positionAfter = await fetchPositionByMint(positionMint);
    const tokenAAfter = await fetchToken(rpc, ataA);
    const tokenBAfter = await fetchToken(rpc, ataB);
    assert.strictEqual(quote.liquidityDelta, positionAfter.data.liquidity);
    assert.strictEqual(tokenAAfter.data.amount - tokenABefore.data.amount, -quote.tokenEstA);
    assert.strictEqual(tokenBAfter.data.amount - tokenBBefore.data.amount, -quote.tokenEstB);

    return positionMint;
  };

  const testIncreaseLiquidity = async (positionMint: Address) => {
    const positionBefore = await fetchPositionByMint(positionMint);
    const tokenABefore = await fetchToken(rpc, ataA);
    const tokenBBefore = await fetchToken(rpc, ataB);

    const { instructions, quote } = await increaseLiquidityInstructions(rpc, positionMint, { liquidity: 10000n });
    await sendTransaction(instructions);

    const positionAfter = await fetchPositionByMint(positionMint);
    const tokenAAfter = await fetchToken(rpc, ataA);
    const tokenBAfter = await fetchToken(rpc, ataB);
    assert.strictEqual(positionAfter.data.liquidity - positionBefore.data.liquidity, quote.liquidityDelta);
    assert.strictEqual(tokenAAfter.data.amount - tokenABefore.data.amount, -quote.tokenEstA);
    assert.strictEqual(tokenBAfter.data.amount - tokenBBefore.data.amount, -quote.tokenEstB);
  };

  const testDecreaseLiquidity = async (positionMint: Address) => {
    const positionBefore = await fetchPositionByMint(positionMint);
    const tokenABefore = await fetchToken(rpc, ataA);
    const tokenBBefore = await fetchToken(rpc, ataB);

    const { instructions, quote } = await decreaseLiquidityInstructions(rpc, positionMint, { liquidity: 10000n });
    await sendTransaction(instructions);

    const positionAfter = await fetchPositionByMint(positionMint);
    const tokenAAfter = await fetchToken(rpc, ataA);
    const tokenBAfter = await fetchToken(rpc, ataB);
    assert.strictEqual(positionAfter.data.liquidity - positionBefore.data.liquidity, -quote.liquidityDelta);
    assert.strictEqual(tokenAAfter.data.amount - tokenABefore.data.amount, quote.tokenEstA);
    assert.strictEqual(tokenBAfter.data.amount - tokenBBefore.data.amount, quote.tokenEstB);
  };

  const testHarvest = async (positionMint: Address) => {
    const tokenABefore = await fetchToken(rpc, ataA);
    const tokenBBefore = await fetchToken(rpc, ataB);

    const { instructions, feesQuote } = await harvestPositionInstructions(rpc, positionMint);
    await sendTransaction(instructions);

    const tokenAAfter = await fetchToken(rpc, ataA);
    const tokenBAfter = await fetchToken(rpc, ataB);
    assert.strictEqual(tokenAAfter.data.amount - tokenABefore.data.amount, feesQuote.feeOwedA);
    assert.strictEqual(tokenBAfter.data.amount - tokenBBefore.data.amount, feesQuote.feeOwedB);
  };

  const testClosePosition = async (positionMint: Address) => {
    const tokenABefore = await fetchToken(rpc, ataA);
    const tokenBBefore = await fetchToken(rpc, ataB);

    const { instructions, quote, feesQuote } = await closePositionInstructions(rpc, positionMint);
    await sendTransaction(instructions);

    const positionAfter = await rpc.getMultipleAccounts([positionMint]).send();
    const tokenAAfter = await fetchToken(rpc, ataA);
    const tokenBAfter = await fetchToken(rpc, ataB);
    assert.strictEqual(positionAfter.value[0], null);
    assert.strictEqual(tokenAAfter.data.amount - tokenABefore.data.amount, quote.tokenEstA + feesQuote.feeOwedA);
    assert.strictEqual(tokenBAfter.data.amount - tokenBBefore.data.amount, quote.tokenEstB + feesQuote.feeOwedB);
  };

  const testSwapAExactIn = async (poolAddress: Address) => {
    const tokenABefore = await fetchToken(rpc, ataA);
    const tokenBBefore = await fetchToken(rpc, ataB);

    const { instructions, quote } = await swapInstructions(rpc, { inputAmount: 100000n, mint: mintA }, poolAddress);
    await sendTransaction(instructions);

    const tokenAAfter = await fetchToken(rpc, ataA);
    const tokenBAfter = await fetchToken(rpc, ataB);

    assert.strictEqual(tokenAAfter.data.amount - tokenABefore.data.amount, -quote.tokenIn);
    assert.strictEqual(tokenBAfter.data.amount - tokenBBefore.data.amount, quote.tokenEstOut);
  };

  const testSwapAExactOut = async (poolAddress: Address) => {
    const tokenABefore = await fetchToken(rpc, ataA);
    const tokenBBefore = await fetchToken(rpc, ataB);

    const { instructions, quote } = await swapInstructions(rpc, { outputAmount: 100000n, mint: mintA }, poolAddress);
    await sendTransaction(instructions);

    const tokenAAfter = await fetchToken(rpc, ataA);
    const tokenBAfter = await fetchToken(rpc, ataB);

    assert.strictEqual(tokenAAfter.data.amount - tokenABefore.data.amount, quote.tokenOut);
    assert.strictEqual(tokenBAfter.data.amount - tokenBBefore.data.amount, -quote.tokenEstIn);
  };

  const testSwapBExactIn = async (poolAddress: Address) => {
    const tokenABefore = await fetchToken(rpc, ataA);
    const tokenBBefore = await fetchToken(rpc, ataB);

    const { instructions, quote } = await swapInstructions(rpc, { inputAmount: 100n, mint: mintB }, poolAddress);
    await sendTransaction(instructions);

    const tokenAAfter = await fetchToken(rpc, ataA);
    const tokenBAfter = await fetchToken(rpc, ataB);

    assert.strictEqual(tokenAAfter.data.amount - tokenABefore.data.amount, quote.tokenEstOut);
    assert.strictEqual(tokenBAfter.data.amount - tokenBBefore.data.amount, -quote.tokenIn);
  };

  const testSwapBExactOut = async (poolAddress: Address) => {
    const tokenABefore = await fetchToken(rpc, ataA);
    const tokenBBefore = await fetchToken(rpc, ataB);

    const { instructions, quote } = await swapInstructions(rpc, { outputAmount: 100n, mint: mintB }, poolAddress);
    await sendTransaction(instructions);

    const tokenAAfter = await fetchToken(rpc, ataA);
    const tokenBAfter = await fetchToken(rpc, ataB);

    assert.strictEqual(tokenAAfter.data.amount - tokenABefore.data.amount, -quote.tokenEstIn);
    assert.strictEqual(tokenBAfter.data.amount - tokenBBefore.data.amount, quote.tokenOut);
  };

  it("Concentrated liquidity pool", async () => {
    const poolAddress = await testInitConcentratedLiquidityPool();
    const positionMint = await testOpenPosition(poolAddress);
    await testSwapAExactIn(poolAddress);
    await testIncreaseLiquidity(positionMint);
    await testSwapAExactOut(poolAddress);
    await testHarvest(positionMint);
    await testSwapBExactIn(poolAddress);
    await testDecreaseLiquidity(positionMint);
    await testSwapBExactOut(poolAddress);
    await testClosePosition(positionMint);
  });
});
