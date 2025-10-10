//
// Copyright (c) Cryptic Dot
//
// Modification based on Orca Whirlpools (https://github.com/orca-so/whirlpools),
// originally licensed under the Apache License, Version 2.0, prior to February 26, 2025.
//
// Modifications licensed under FusionAMM SDK Source-Available License v1.0
// See the LICENSE file in the project root for license information.
//

import { describe, it } from "vitest";
import type {
  PositionFacade,
  TickArrayFacade,
  TickFacade,
  FusionPoolFacade,
} from "../dist/nodejs/fusionamm_core_js_bindings";
import {
  collectFeesQuote,
  decreaseLiquidityQuote,
  increaseLiquidityQuote,
  swapQuoteByInputToken,
  swapQuoteByOutputToken,
} from "../dist/nodejs/fusionamm_core_js_bindings";
import assert from "assert";

// Assumption: if a complex test cases produces the same result as the rust test,
// then the WASM bundle is working correctly and we don't need to test every single
// function in the WASM bundle.

function testFusionPool(): FusionPoolFacade {
  return {
    tickCurrentIndex: 0,
    protocolFeeRate: 3000,
    feeRate: 3000,
    liquidity: 265000n,
    sqrtPrice: 1n << 64n,
    tickSpacing: 2,
    feeGrowthGlobalA: 800n,
    feeGrowthGlobalB: 1000n,
    ordersTotalAmountA: 5000n,
    ordersTotalAmountB: 7000n,
    ordersFilledAmountA: 1000n,
    ordersFilledAmountB: 30000n,
    olpFeeOwedA: 50n,
    olpFeeOwedB: 60n,
  };
}

function testTick(positive: boolean = true): TickFacade {
  const liquidityNet = positive ? 1000n : -1000n;
  return {
    initialized: true,
    liquidityNet,
    liquidityGross: 1000n,
    feeGrowthOutsideA: 50n,
    feeGrowthOutsideB: 20n,
    age: 0n,
    openOrdersInput: 0n,
    partFilledOrdersInput: 0n,
    partFilledOrdersRemainingInput: 0n,
    fulfilledAToBOrdersInput: 0n,
    fulfilledBToAOrdersInput: 0n,
  };
}

function testTickArray(startTickIndex: number): TickArrayFacade {
  return {
    startTickIndex,
    ticks: Array.from({ length: 88 }, () => testTick(startTickIndex < 0)),
  };
}

function testPosition(): PositionFacade {
  return {
    liquidity: 50n,
    tickLowerIndex: -5,
    tickUpperIndex: 5,
    feeGrowthCheckpointA: 0n,
    feeOwedA: 400n,
    feeGrowthCheckpointB: 0n,
    feeOwedB: 600n,
  };
}

describe("WASM bundle smoke test", () => {
  it("SwapIn", async () => {
    const result = swapQuoteByInputToken(1000n, false, 1000, testFusionPool(), [
      testTickArray(0),
      testTickArray(176),
      testTickArray(352),
      testTickArray(-176),
      testTickArray(-352),
    ]);
    assert.strictEqual(result.tokenIn, 1000n);
    assert.strictEqual(result.tokenEstOut, 918n);
    assert.strictEqual(result.tokenMinOut, 826n);
    assert.strictEqual(result.tradeFee, 39n);
  });

  it("SwapOut", async () => {
    const result = swapQuoteByOutputToken(1000n, true, 1000, testFusionPool(), [
      testTickArray(0),
      testTickArray(176),
      testTickArray(352),
      testTickArray(-176),
      testTickArray(-352),
    ]);
    assert.strictEqual(result.tokenOut, 1000n);
    assert.strictEqual(result.tokenEstIn, 1088n);
    assert.strictEqual(result.tokenMaxIn, 1197n);
    assert.strictEqual(result.tradeFee, 42n);
  });

  it("IncreaseLiquidity", async () => {
    const result = increaseLiquidityQuote(
      1000000n,
      100,
      18446744073709551616n,
      -10,
      10,
      { feeBps: 2000, maxFee: 100000n },
      { feeBps: 1000, maxFee: 100000n },
    );
    assert.strictEqual(result.liquidityDelta, 1000000n);
    assert.strictEqual(result.tokenEstA, 625n);
    assert.strictEqual(result.tokenEstB, 556n);
    assert.strictEqual(result.tokenMaxA, 632n);
    assert.strictEqual(result.tokenMaxB, 562n);
  });

  it("DecreaseLiquidity", async () => {
    const result = decreaseLiquidityQuote(
      1000000n,
      100,
      18446744073709551616n,
      -10,
      10,
      { feeBps: 2000, maxFee: 100000n },
      { feeBps: 1000, maxFee: 100000n },
    );
    assert.strictEqual(result.liquidityDelta, 1000000n);
    assert.strictEqual(result.tokenEstA, 399n);
    assert.strictEqual(result.tokenEstB, 449n);
    assert.strictEqual(result.tokenMinA, 395n);
    assert.strictEqual(result.tokenMinB, 444n);
  });

  it("CollectFeesQuote", async () => {
    const result = collectFeesQuote(
      testFusionPool(),
      testPosition(),
      testTick(),
      testTick(),
      { feeBps: 2000, maxFee: 100000n },
      { feeBps: 5000, maxFee: 100000n },
    );
    assert.strictEqual(result.feeOwedA, 320n);
    assert.strictEqual(result.feeOwedB, 300n);
  });
});
