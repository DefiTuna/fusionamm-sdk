//
// Copyright (c) Cryptic Dot
//
// Modification based on Orca Whirlpools (https://github.com/orca-so/whirlpools),
// originally licensed under the Apache License, Version 2.0, prior to February 26, 2025.
//
// Modifications licensed under FusionAMM SDK Source-Available License v1.0
// See the LICENSE file in the project root for license information.
//

import { fetchFusionPool } from "@crypticdot/fusionamm-client";
import { Address } from "@solana/kit";
import { beforeAll, describe, expect, it } from "vitest";
import { swapInstructions } from "../src";
import { rpc, sendTransaction } from "./utils/mockRpc";
import { moveTimeForward } from "./utils/time";
import { setupAta, setupMint } from "./utils/token";
import { setupPosition, setupFusionPool } from "./utils/program";
import { sqrtPriceToPrice } from "@crypticdot/fusionamm-core";

describe("MA price", () => {
  let mintA: Address;
  let mintB: Address;
  let pool: Address;

  beforeAll(async () => {
    mintA = await setupMint();
    mintB = await setupMint();
    await setupAta(mintA, { amount: 500e9 });
    await setupAta(mintB, { amount: 500e9 });
    pool = await setupFusionPool(mintA, mintB, 128);
    await setupPosition(pool, { tickLower: -128, tickUpper: 128, liquidity: 1000000n });
  });

  const testSwapA = async (inputAmount = 1000n) => {
    const { instructions } = await swapInstructions(rpc, { inputAmount, mint: mintA }, pool, 100);
    await sendTransaction(instructions);
  };

  it("MA update", async () => {
    let fusionPool = await fetchFusionPool(rpc, pool);
    expect(fusionPool.data.maSqrtPrice).toEqual(18446744073709551616n);

    // The EMA price is not updated after the second swap because the elapsed time is zero.
    await testSwapA();
    fusionPool = await fetchFusionPool(rpc, pool);
    expect(fusionPool.data.maSqrtPrice).toEqual(18446744073709551616n);
    await testSwapA();
    fusionPool = await fetchFusionPool(rpc, pool);
    expect(fusionPool.data.sqrtPrice).toEqual(18409960971688118756n);
    expect(fusionPool.data.maSqrtPrice).toEqual(18446744073709551616n);

    // Make EMA price equal to the current price
    await moveTimeForward(10000n);
    await testSwapA(1n);
    fusionPool = await fetchFusionPool(rpc, pool);
    expect(sqrtPriceToPrice(fusionPool.data.sqrtPrice, 9, 9)).toEqual(0.9960159441873938);
    expect(sqrtPriceToPrice(fusionPool.data.maSqrtPrice, 9, 9)).toEqual(0.9960159441873938);

    // Swap at the same timestamp
    await testSwapA();
    fusionPool = await fetchFusionPool(rpc, pool);
    expect(sqrtPriceToPrice(fusionPool.data.sqrtPrice, 9, 9)).toEqual(0.9940328387526128);
    expect(sqrtPriceToPrice(fusionPool.data.maSqrtPrice, 9, 9)).toEqual(0.9960159441873938);

    // Wait for a long time and swap
    await moveTimeForward(10000n);
    await testSwapA();
    fusionPool = await fetchFusionPool(rpc, pool);
    expect(sqrtPriceToPrice(fusionPool.data.sqrtPrice, 9, 9)).toEqual(0.9920556500840351);
    expect(sqrtPriceToPrice(fusionPool.data.maSqrtPrice, 9, 9)).toEqual(0.9940328387526128);
  });
});
