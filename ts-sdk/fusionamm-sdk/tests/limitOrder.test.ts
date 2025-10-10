//
// Copyright (c) Cryptic Dot
//
// Modification based on Orca Whirlpools (https://github.com/orca-so/whirlpools),
// originally licensed under the Apache License, Version 2.0, prior to February 26, 2025.
//
// Modifications licensed under FusionAMM SDK Source-Available License v1.0
// See the LICENSE file in the project root for license information.
//

import { findAssociatedTokenPda } from "@solana-program/token";
import { describe, it, beforeAll, expect } from "vitest";
import {
  closeLimitOrderInstructions,
  harvestPositionInstructions,
  openLimitOrderInstructions,
  openPositionInstructions,
  PriceOrTickIndex,
  swapInstructions,
} from "../src";
import { rpc, signer, sendTransaction } from "./utils/mockRpc";
import { setupMint, setupAta } from "./utils/token";
import {
  fetchFusionPool,
  fetchLimitOrder,
  fetchTickArray,
  FusionPool, getFusionPoolsConfigAddress,
  getLimitOrderAddress,
  getTickArrayAddress,
} from "@crypticdot/fusionamm-client";
import { fetchAllMint, fetchMint, fetchToken } from "@solana-program/token-2022";
import { Account, Address, KeyPairSigner } from "@solana/kit";
import assert from "assert";
import { setupFusionPool } from "./utils/program";
import { setupAtaTE, setupMintTE, setupMintTEFee } from "./utils/tokenExtensions";
import {
  decreaseLimitOrderQuote,
  getTickArrayStartTickIndex,
  limitOrderQuoteByInputToken,
  sqrtPriceToPrice,
} from "@crypticdot/fusionamm-core";

const mintTypes = new Map([
  ["A", setupMint],
  ["B", setupMint],
  ["TEA", setupMintTE],
  ["TEB", setupMintTE],
  ["TEFee", setupMintTEFee],
]);

const ataTypes = new Map([
  ["A", setupAta],
  ["B", setupAta],
  ["TEA", setupAtaTE],
  ["TEB", setupAtaTE],
  ["TEFee", setupAtaTE],
]);

const poolTypes = ["A-B", "A-TEA", "TEA-TEB", "A-TEFee"];

describe("Limit Orders", () => {
  const tickSpacing = 64;

  beforeAll(async () => {
  });

  const fetchAndLogTickByTickIndex = async (fusionPool: Account<FusionPool>, tickIndex: number) => {
    const tickArrayStartIndex = getTickArrayStartTickIndex(tickIndex, fusionPool.data.tickSpacing);
    const tickArrayAddress = (await getTickArrayAddress(fusionPool.address, tickArrayStartIndex))[0];
    const tickArray = await fetchTickArray(rpc, tickArrayAddress);
    console.log(
      `TICK ${tickIndex}: `,
      tickArray.data.ticks[(tickIndex - tickArrayStartIndex) / fusionPool.data.tickSpacing],
    );
  };

  const testOpenLimitOrder = async (args: {
    poolAddress: Address;
    amount: bigint;
    priceOrTickIndex: PriceOrTickIndex;
    aToB: boolean;
    signer?: KeyPairSigner;
  }) => {
    const { amount, priceOrTickIndex, aToB, poolAddress } = args;
    const owner = args.signer ?? signer;

    let fusionPool = await fetchFusionPool(rpc, poolAddress);
    const [mintA, mintB] = await fetchAllMint(rpc, [fusionPool.data.tokenMintA, fusionPool.data.tokenMintB]);

    const ataAAddress = (
      await findAssociatedTokenPda({
        mint: fusionPool.data.tokenMintA,
        owner: owner.address,
        tokenProgram: mintA.programAddress,
      })
    )[0];
    const ataBAddress = (
      await findAssociatedTokenPda({
        mint: fusionPool.data.tokenMintB,
        owner: owner.address,
        tokenProgram: mintB.programAddress,
      })
    )[0];

    const { limitOrderMint, instructions, amountWithFee } = await openLimitOrderInstructions(
      rpc,
      poolAddress,
      amount,
      priceOrTickIndex,
      aToB,
    );

    const tokenBeforeA = ataAAddress ? await fetchToken(rpc, ataAAddress) : undefined;
    const tokenBeforeB = ataBAddress ? await fetchToken(rpc, ataBAddress) : undefined;

    await sendTransaction(instructions);

    const limitOrderAddress = await getLimitOrderAddress(limitOrderMint);
    const limitOrder = await fetchLimitOrder(rpc, limitOrderAddress[0]);

    if (ataAAddress && ataBAddress) {
      const tokenAfterA = await fetchToken(rpc, ataAAddress);
      const tokenAfterB = await fetchToken(rpc, ataBAddress);
      const balanceChangeTokenA = tokenBeforeA!.data.amount - tokenAfterA.data.amount;
      const balanceChangeTokenB = tokenBeforeB!.data.amount - tokenAfterB.data.amount;

      assert.strictEqual(aToB ? balanceChangeTokenA : balanceChangeTokenB, amountWithFee);
      assert.strictEqual(aToB ? balanceChangeTokenB : balanceChangeTokenA, 0n);
      assert.strictEqual(limitOrder.data.amount, amount);
      assert.strictEqual(limitOrder.data.aToB, aToB);
    }

    return limitOrder;
  };

  const testCloseLimitOrder = async (args: { limitOrderMint: Address }) => {
    const { limitOrderMint } = args;

    const { instructions } = await closeLimitOrderInstructions(rpc, limitOrderMint);

    await sendTransaction(instructions);
  };

  const testSwapExactInput = async (args: { poolAddress: Address; mint: Address; inputAmount: bigint }) => {
    let { instructions } = await swapInstructions(
      rpc,
      { inputAmount: args.inputAmount, mint: args.mint },
      args.poolAddress,
    );
    await sendTransaction(instructions);
  };

  for (const poolName of poolTypes) {
    it(`Open limit orders, swap and close orders for ${poolName}`, async () => {
      const [mintAName, mintBName] = poolName.split("-");

      const setupMintA = mintTypes.get(mintAName)!;
      const setupMintB = mintTypes.get(mintBName)!;
      const setupAtaA = ataTypes.get(mintAName)!;
      const setupAtaB = ataTypes.get(mintBName)!;

      const mintAAddress = await setupMintA();
      const mintBAddress = await setupMintB();
      const mintA = await fetchMint(rpc, mintAAddress);
      const mintB = await fetchMint(rpc, mintBAddress);
      const ataAAddress = await setupAtaA(mintAAddress, { amount: 100_000_000n });
      const ataBAddress = await setupAtaB(mintBAddress, { amount: 100_000_000n });
      const poolAddress = await setupFusionPool(mintAAddress, mintBAddress, tickSpacing);

      const limitOrdersArgs = [
        { amount: 500_000n, priceOffset: -0.06, aToB: false }, // 1st
        { amount: 500_000n, priceOffset: -0.06, aToB: false }, // 1st
        { amount: 500_000n, priceOffset: -0.1, aToB: false }, // 2nd
        { amount: 500_000n, priceOffset: -0.1, aToB: false }, // 2nd
        { amount: 500_000n, priceOffset: -0.15, aToB: false }, // 3rd
        { amount: 500_000n, priceOffset: -0.15, aToB: false }, // 3rd
        { amount: 500_000n, priceOffset: -0.2, aToB: false }, // 4th
        { amount: 500_000n, priceOffset: -0.2, aToB: false }, // 4th

        { amount: 500_000n, priceOffset: 0.06, aToB: true },
        { amount: 500_000n, priceOffset: 0.06, aToB: true },
        { amount: 500_000n, priceOffset: 0.1, aToB: true },
        { amount: 500_000n, priceOffset: 0.1, aToB: true },
        { amount: 500_000n, priceOffset: 0.15, aToB: true },
        { amount: 500_000n, priceOffset: 0.15, aToB: true },
        { amount: 500_000n, priceOffset: 0.2, aToB: true },
        { amount: 500_000n, priceOffset: 0.2, aToB: true },
      ];

      const orders = [];

      let fusionPool = await fetchFusionPool(rpc, poolAddress);
      let currentPrice = sqrtPriceToPrice(fusionPool.data.sqrtPrice, mintA.data.decimals, mintB.data.decimals);

      for (const args of limitOrdersArgs) {
        orders.push(
          await testOpenLimitOrder({
            ...args,
            priceOrTickIndex: { price: currentPrice + args.priceOffset },
            poolAddress,
            signer,
          }),
        );
      }

      // The 1st order will be fulfilled, the 2nd - partially filled, the 3rd - not filled.
      await testSwapExactInput({ poolAddress, inputAmount: 1_500_000n, mint: mintAAddress });
      await testSwapExactInput({ poolAddress, inputAmount: 1_500_000n, mint: mintBAddress });

      // Fill 2nd, and partially fill 3rd
      await testSwapExactInput({ poolAddress, inputAmount: 1_000_000n, mint: mintAAddress });
      await testSwapExactInput({ poolAddress, inputAmount: 1_000_000n, mint: mintBAddress });

      fusionPool = await fetchFusionPool(rpc, poolAddress);
      currentPrice = sqrtPriceToPrice(fusionPool.data.sqrtPrice, mintA.data.decimals, mintB.data.decimals);
      //console.log("PRICE =", currentPrice);

      /*
      fusionPool = await fetchFusionPool(rpc, poolAddress);
      poolVaultA = await fetchToken(rpc, fusionPool.data.tokenVaultA);
      poolVaultB = await fetchToken(rpc, fusionPool.data.tokenVaultB);
      console.log(`Pool balance after B->A swap: [${poolVaultA.data.amount}, ${poolVaultB.data.amount}]`);
      console.log("Pool tick after B->A swap", fusionPool.data.tickCurrentIndex);

      for (let i = 0; i < limitOrders.length; i++) {
        const tickArrayStartIndex = getTickArrayStartTickIndex(
          limitOrders[i].data.tickIndex,
          fusionPool.data.tickSpacing,
        );
        const tickArrayAddress = (await getTickArrayAddress(fusionPool.address, tickArrayStartIndex))[0];
        const tickArray = await fetchTickArray(rpc, tickArrayAddress);
        console.log(
          `TICK ${limitOrders[i].data.tickIndex}: `,
          tickArray.data.ticks[(limitOrders[i].data.tickIndex - tickArrayStartIndex) / fusionPool.data.tickSpacing],
        );
      }*/

      for (const args of limitOrdersArgs) {
        orders.push(
          await testOpenLimitOrder({
            ...args,
            priceOrTickIndex: { price: currentPrice + args.priceOffset },
            poolAddress,
            signer,
          }),
        );
      }

      // The 1st order will be fulfilled, the 2nd - partially filled, the 3rd - not filled.
      await testSwapExactInput({ poolAddress, inputAmount: 1_500_000n, mint: mintAAddress });
      await testSwapExactInput({ poolAddress, inputAmount: 1_500_000n, mint: mintBAddress });

      // Fill 2nd, and partially fill 3rd
      await testSwapExactInput({ poolAddress, inputAmount: 1_000_000n, mint: mintAAddress });
      await testSwapExactInput({ poolAddress, inputAmount: 1_000_000n, mint: mintBAddress });

      fusionPool = await fetchFusionPool(rpc, poolAddress);
      expect(fusionPool.data.protocolFeeOwedA).toEqual(11n);
      expect(fusionPool.data.protocolFeeOwedB).toEqual(poolName == "A-TEFee" ? 11n : 13n);
      expect(fusionPool.data.ordersTotalAmountA).toEqual(8000000n);
      expect(fusionPool.data.ordersTotalAmountB).toEqual(8000000n);

      expect(fusionPool.data.ordersFilledAmountA).toEqual(poolName == "A-TEFee" ? 4380687n : 4422472n);
      expect(fusionPool.data.ordersFilledAmountB).toEqual(4876385n);
      expect(fusionPool.data.olpFeeOwedA).toEqual(1493n);
      expect(fusionPool.data.olpFeeOwedB).toEqual(poolName == "A-TEFee" ? 1476n : 1490n);

      for (const order of orders) {
        await testCloseLimitOrder({
          limitOrderMint: order.data.limitOrderMint,
        });
      }

      fusionPool = await fetchFusionPool(rpc, poolAddress);
      expect(fusionPool.data.protocolFeeOwedA).toEqual(11n);
      expect(fusionPool.data.protocolFeeOwedB).toEqual(poolName == "A-TEFee" ? 11n : 13n);
      expect(fusionPool.data.ordersTotalAmountA).toEqual(0n);
      expect(fusionPool.data.ordersTotalAmountB).toEqual(0n);
      expect(fusionPool.data.ordersFilledAmountA).toEqual(0n);
      expect(fusionPool.data.ordersFilledAmountB).toEqual(0n);
      expect(fusionPool.data.olpFeeOwedA).toEqual(0n);
      expect(fusionPool.data.olpFeeOwedB).toEqual(0n);

      const poolVaultA = await fetchToken(rpc, fusionPool.data.tokenVaultA);
      const poolVaultB = await fetchToken(rpc, fusionPool.data.tokenVaultB);
      expect(poolVaultA.data.amount - fusionPool.data.protocolFeeOwedA).toEqual(11n);
      expect(poolVaultB.data.amount - fusionPool.data.protocolFeeOwedB).toEqual(poolName == "A-TEFee" ? 10n : 9n);
    });
  }

  it(`Open a position on a tick initialized by the limit order`, async () => {
    const setupMintA = mintTypes.get("A")!;
    const setupMintB = mintTypes.get("B")!;
    const setupAtaA = ataTypes.get("A")!;
    const setupAtaB = ataTypes.get("B")!;

    const mintAAddress = await setupMintA();
    const mintBAddress = await setupMintB();
    const mintA = await fetchMint(rpc, mintAAddress);
    const mintB = await fetchMint(rpc, mintBAddress);
    const ataAAddress = await setupAtaA(mintAAddress, { amount: 100_000_000n });
    const ataBAddress = await setupAtaB(mintBAddress, { amount: 100_000_000n });
    const poolAddress = await setupFusionPool(mintAAddress, mintBAddress, tickSpacing);

    // let fusionPool = await fetchFusionPool(rpc, poolAddress);
    // let price = sqrtPriceToPrice(fusionPool.data.sqrtPrice, mintA.data.decimals, mintB.data.decimals);
    // console.log(`1: tick = ${fusionPool.data.tickCurrentIndex}, price = ${price}`);

    await testOpenLimitOrder({
      amount: 500_000n,
      aToB: false,
      priceOrTickIndex: { tickIndex: -256 },
      poolAddress,
      signer,
    });

    const innerPositionIx = await openPositionInstructions(
      rpc,
      poolAddress,
      { tokenA: 1_000_000n },
      { tickIndex: -128 },
      { tickIndex: 128 },
    );
    await sendTransaction(innerPositionIx.instructions);

    // Generate fees inside the inner position
    await testSwapExactInput({ poolAddress, inputAmount: 700_000n, mint: mintBAddress });
    await testSwapExactInput({ poolAddress, inputAmount: 700_000n, mint: mintAAddress });

    //fusionPool = await fetchFusionPool(rpc, poolAddress);
    //price = sqrtPriceToPrice(fusionPool.data.sqrtPrice, mintA.data.decimals, mintB.data.decimals);
    //console.log(`2: tick = ${fusionPool.data.tickCurrentIndex}, price = ${price}`);

    //console.log("BEFORE OPENING OUTER");
    //await fetchAndLogTickByTickIndex(fusionPool, -256);

    // Open the outer position
    const outerPositionIx = await openPositionInstructions(
      rpc,
      poolAddress,
      { tokenA: 1_000_000n },
      { tickIndex: -256 },
      { tickIndex: 256 },
    );
    await sendTransaction(outerPositionIx.instructions);

    //console.log("AFTER OPENING OUTER");
    //await fetchAndLogTickByTickIndex(fusionPool, -256);

    //const positionAddress = (await getPositionAddress(outerPositionIx.positionMint))[0];
    //const position = await fetchPosition(rpc, positionAddress);
    //console.log("position =", position);

    // Generate fees
    await testSwapExactInput({ poolAddress, inputAmount: 1400_000n, mint: mintBAddress });
    await testSwapExactInput({ poolAddress, inputAmount: 300_000n, mint: mintAAddress });

    // fusionPool = await fetchFusionPool(rpc, poolAddress);
    // price = sqrtPriceToPrice(fusionPool.data.sqrtPrice, mintA.data.decimals, mintB.data.decimals);
    // console.log(`4: tick = ${fusionPool.data.tickCurrentIndex}, price = ${price}`);

    const tokenABefore = await fetchToken(rpc, ataAAddress);
    const tokenBBefore = await fetchToken(rpc, ataBAddress);

    const harvestIx = await harvestPositionInstructions(rpc, outerPositionIx.positionMint);
    //console.log("Fees = ", harvestIx.feesQuote);
    await sendTransaction(harvestIx.instructions);

    const tokenAAfter = await fetchToken(rpc, ataAAddress);
    const tokenBAfter = await fetchToken(rpc, ataBAddress);
    expect(harvestIx.feesQuote.feeOwedA).equals(30n);
    expect(harvestIx.feesQuote.feeOwedB).equals(138n);
    expect(harvestIx.feesQuote.feeOwedA).equals(tokenAAfter.data.amount - tokenABefore.data.amount);
    expect(harvestIx.feesQuote.feeOwedB).equals(tokenBAfter.data.amount - tokenBBefore.data.amount);
  });

  it(`Quote and decrease limit order`, async () => {
    const mintAName = "A";
    const mintBName = "B";
    const setupMintA = mintTypes.get(mintAName)!;
    const setupMintB = mintTypes.get(mintBName)!;
    const setupAtaA = ataTypes.get(mintAName)!;
    const setupAtaB = ataTypes.get(mintBName)!;

    const mintAAddress = await setupMintA();
    const mintBAddress = await setupMintB();
    const mintA = await fetchMint(rpc, mintAAddress);
    const mintB = await fetchMint(rpc, mintBAddress);
    const ataAAddress = await setupAtaA(mintAAddress, { amount: 100_000_000n });
    const ataBAddress = await setupAtaB(mintBAddress, { amount: 100_000_000n });
    const poolAddress = await setupFusionPool(mintAAddress, mintBAddress, tickSpacing);

    const limitOrdersArgs = [
      { amount: 1_000_000n, priceOffset: -0.06, aToB: false }, // 1st
      { amount: 1_000_000n, priceOffset: -0.1, aToB: false }, // 2nd
    ];

    const orders = [];
    let fusionPool = await fetchFusionPool(rpc, poolAddress);
    let currentPrice = sqrtPriceToPrice(fusionPool.data.sqrtPrice, mintA.data.decimals, mintB.data.decimals);

    for (const args of limitOrdersArgs) {
      orders.push(
        await testOpenLimitOrder({
          ...args,
          priceOrTickIndex: { price: currentPrice + args.priceOffset },
          poolAddress,
          signer,
        }),
      );
    }

    const limitOrder = orders[0].data;

    // Quote the limit order output
    const quotedAmountOut = limitOrderQuoteByInputToken(orders[0].data.amount, orders[0].data.aToB, orders[0].data.tickIndex, fusionPool.data);
    // The actual limit order output will be 1066409.
    // It happens because the quote function has different math. A small error is fine.
    expect(quotedAmountOut).toEqual(1066405n);

    // The 1st order will be fulfilled.
    await testSwapExactInput({ poolAddress, inputAmount: 1_500_000n, mint: mintAAddress });

    fusionPool = await fetchFusionPool(rpc, poolAddress);
    const startTickIndex = getTickArrayStartTickIndex(limitOrder.tickIndex, fusionPool.data.tickSpacing);
    const tickArrayAddress = await getTickArrayAddress(fusionPool.address, startTickIndex);
    const tickArray = await fetchTickArray(rpc, tickArrayAddress[0]);

    // Decrease Limit Order Quote
    const tick = tickArray.data.ticks[(limitOrder.tickIndex - startTickIndex) / fusionPool.data.tickSpacing];
    const decreaseQuote = decreaseLimitOrderQuote(fusionPool.data, limitOrder, tick, limitOrder.amount);
    expect(decreaseQuote.amountOutA).toEqual(1066409n);
    expect(decreaseQuote.amountOutB).toEqual(0n);

    // Execute the decrease order instruction
    const tokenBeforeA = await fetchToken(rpc, ataAAddress);
    const tokenBeforeB = await fetchToken(rpc, ataBAddress);
    await testCloseLimitOrder({
      limitOrderMint: orders[0].data.limitOrderMint,
    });
    const tokenAfterA = await fetchToken(rpc, ataAAddress);
    const tokenAfterB = await fetchToken(rpc, ataBAddress);
    expect(tokenAfterA.data.amount - tokenBeforeA.data.amount).toEqual(1066409n);
    expect(tokenAfterB.data.amount - tokenBeforeB.data.amount).toEqual(0n);
  });
});
