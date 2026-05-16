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
  fetchFusionPool,
  fetchLimitOrder,
  fetchMaybeTickArray,
  fetchTickArray,
  getLimitOrderAddress,
  getTickArrayAddress,
  LimitOrder,
  maybeTickToFacade,
} from "@crypticdot/fusionamm-client";
import {
  decreaseLimitOrderQuote,
  getInitializableTickIndex,
  getTickArrayStartTickIndex,
  limitOrderQuoteByInputToken,
  priceToTickIndex,
  sqrtPriceToPrice,
} from "@crypticdot/fusionamm-core";
import { Account, Address, generateKeyPairSigner, KeyPairSigner } from "@solana/kit";
import { findAssociatedTokenPda } from "@solana-program/token";
import { fetchAllMint, fetchMint, fetchToken } from "@solana-program/token-2022";
import assert from "assert";
import { beforeAll, describe, expect, it } from "vitest";

import {
  closeLimitOrderInstructions,
  harvestPositionInstructions,
  openLimitOrderInstructions,
  openPositionInstructions,
  PriceOrTickIndex,
  swapInstructions,
} from "../src";

import { rpc, sendTransaction, signer } from "./utils/mockRpc";
import { setupFusionPool } from "./utils/program";
import { setupAta, setupMint } from "./utils/token";
import { setupAtaTE, setupMintTE, setupMintTEFee } from "./utils/tokenExtensions";

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

  beforeAll(async () => {});

  /*
  const fetchAndLogTickByTickIndex = async (fusionPool: Account<FusionPool>, tickIndex: number) => {
    const tickArrayStartIndex = getTickArrayStartTickIndex(tickIndex, fusionPool.data.tickSpacing);
    const tickArrayAddress = (await getTickArrayAddress(fusionPool.address, tickArrayStartIndex))[0];
    const tickArray = await fetchTickArray(rpc, tickArrayAddress);
    console.log(
      `TICK ${tickIndex}: `,
      tickArray.data.ticks[(tickIndex - tickArrayStartIndex) / fusionPool.data.tickSpacing],
    );
  };
  */

  const testOpenLimitOrder = async (args: {
    poolAddress: Address;
    amount: bigint;
    priceOrTickIndex: PriceOrTickIndex;
    aToB: boolean;
    signer?: KeyPairSigner;
  }): Promise<Account<LimitOrder>> => {
    const { amount, priceOrTickIndex, aToB, poolAddress } = args;
    const owner = args.signer ?? signer;

    const pool = await fetchFusionPool(rpc, poolAddress);
    const [mintA, mintB] = await fetchAllMint(rpc, [pool.data.tokenMintA, pool.data.tokenMintB]);

    const ataAAddress = (
      await findAssociatedTokenPda({
        mint: pool.data.tokenMintA,
        owner: owner.address,
        tokenProgram: mintA.programAddress,
      })
    )[0];
    const ataBAddress = (
      await findAssociatedTokenPda({
        mint: pool.data.tokenMintB,
        owner: owner.address,
        tokenProgram: mintB.programAddress,
      })
    )[0];

    const limitOrderMint = await generateKeyPairSigner();
    const limitOrderAddress = (await getLimitOrderAddress(limitOrderMint.address))[0];

    const tickIndex =
      priceOrTickIndex.tickIndex ?? priceToTickIndex(priceOrTickIndex.price, mintA.data.decimals, mintB.data.decimals);
    const initializableTickIndex = getInitializableTickIndex(tickIndex, pool.data.tickSpacing, false);
    const tickArrayStartIndex = getTickArrayStartTickIndex(initializableTickIndex, pool.data.tickSpacing);
    const tickArrayAddress = (await getTickArrayAddress(pool.address, tickArrayStartIndex))[0];

    const tickArray = await fetchMaybeTickArray(rpc, tickArrayAddress);
    const tickBefore = tickArray.exists
      ? maybeTickToFacade(tickArray.data.ticks[(initializableTickIndex - tickArrayStartIndex) / pool.data.tickSpacing])
      : undefined;
    const { instructions, amountWithFee } = await openLimitOrderInstructions(
      rpc,
      limitOrderMint,
      poolAddress,
      amount,
      priceOrTickIndex,
      aToB,
    );

    const tokenBeforeA = ataAAddress ? await fetchToken(rpc, ataAAddress) : undefined;
    const tokenBeforeB = ataBAddress ? await fetchToken(rpc, ataBAddress) : undefined;

    await sendTransaction(instructions);

    const limitOrder = await fetchLimitOrder(rpc, limitOrderAddress);

    const tickArrayAfter = await fetchTickArray(rpc, tickArrayAddress);
    const tickAfter = maybeTickToFacade(
      tickArrayAfter.data.ticks[(initializableTickIndex - tickArrayStartIndex) / pool.data.tickSpacing],
    );
    expect(tickAfter.openOrdersInput).toEqual((tickBefore ? tickBefore.openOrdersInput : 0n) + amount);

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

    const limitOrderAddress = (await getLimitOrderAddress(limitOrderMint))[0];
    const limitOrder = await fetchLimitOrder(rpc, limitOrderAddress);

    const poolAddress = limitOrder.data.fusionPool;
    const pool = await fetchFusionPool(rpc, poolAddress);

    const tickIndex = limitOrder.data.tickIndex;
    const amount = limitOrder.data.amount;

    const tickArrayStartIndex = getTickArrayStartTickIndex(tickIndex, pool.data.tickSpacing);
    const tickArrayAddress = (await getTickArrayAddress(poolAddress, tickArrayStartIndex))[0];

    const tickArray = await fetchTickArray(rpc, tickArrayAddress);
    const tickNumber = (tickIndex - tickArrayStartIndex) / pool.data.tickSpacing;
    const tickBefore = maybeTickToFacade(tickArray.data.ticks[tickNumber]);

    const { instructions } = await closeLimitOrderInstructions(rpc, limitOrderMint);
    await sendTransaction(instructions);

    const tickArrayAfter = await fetchTickArray(rpc, tickArrayAddress);
    const tickAfter = maybeTickToFacade(tickArrayAfter.data.ticks[tickNumber]);

    if (limitOrder.data.age == tickBefore.age) {
      expect(tickAfter.openOrdersInput).toEqual(tickBefore.openOrdersInput - amount);
    } else if (limitOrder.data.age + 1n == tickBefore.age) {
      expect(tickAfter.partFilledOrdersInput).toEqual(tickBefore.partFilledOrdersInput - amount);
    } else if (limitOrder.data.age + 2n <= tickBefore.age) {
      if (limitOrder.data.aToB) {
        expect(tickAfter.fulfilledAToBOrdersInput).toEqual(tickBefore.fulfilledAToBOrdersInput - amount);
      } else {
        expect(tickAfter.fulfilledBToAOrdersInput).toEqual(tickBefore.fulfilledBToAOrdersInput - amount);
      }
    }
  };

  const testSwapExactInput = async (args: { poolAddress: Address; mint: Address; inputAmount: bigint }) => {
    const { instructions } = await swapInstructions(
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
      const _ataAAddress = await setupAtaA(mintAAddress, { amount: 100_000_000n });
      const _ataBAddress = await setupAtaB(mintBAddress, { amount: 100_000_000n });
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

      const orders: Account<LimitOrder>[] = [];

      let fusionPool = await fetchFusionPool(rpc, poolAddress);
      let currentPrice = sqrtPriceToPrice(fusionPool.data.sqrtPrice, mintA.data.decimals, mintB.data.decimals);

      for (const args of limitOrdersArgs) {
        const order = await testOpenLimitOrder({
          ...args,
          priceOrTickIndex: { price: currentPrice + args.priceOffset },
          poolAddress,
          signer,
        });
        orders.push(order);
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

      //fusionPool = await fetchFusionPool(rpc, poolAddress);
      //poolVaultA = await fetchToken(rpc, fusionPool.data.tokenVaultA);
      //poolVaultB = await fetchToken(rpc, fusionPool.data.tokenVaultB);
      //console.log(`Pool balance after B->A swap: [${poolVaultA.data.amount}, ${poolVaultB.data.amount}]`);
      //console.log("Pool tick after B->A swap", fusionPool.data.tickCurrentIndex);

      //for (let i = 0; i < limitOrders.length; i++) {
      //  const tickArrayStartIndex = getTickArrayStartTickIndex(
      //    limitOrders[i].data.tickIndex,
      //    fusionPool.data.tickSpacing,
      //  );
      //  const tickArrayAddress = (await getTickArrayAddress(fusionPool.address, tickArrayStartIndex))[0];
      //  const tickArray = await fetchTickArray(rpc, tickArrayAddress);
      //  console.log(
      //    `TICK ${limitOrders[i].data.tickIndex}: `,
      //   tickArray.data.ticks[(limitOrders[i].data.tickIndex - tickArrayStartIndex) / fusionPool.data.tickSpacing],
      //  );
      //}

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
    const _mintA = await fetchMint(rpc, mintAAddress);
    const _mintB = await fetchMint(rpc, mintBAddress);
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
      await generateKeyPairSigner(),
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
      await generateKeyPairSigner(),
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

    const orders: Account<LimitOrder>[] = [];
    let fusionPool = await fetchFusionPool(rpc, poolAddress);
    const currentPrice = sqrtPriceToPrice(fusionPool.data.sqrtPrice, mintA.data.decimals, mintB.data.decimals);

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
    const quotedAmountOut = limitOrderQuoteByInputToken(
      orders[0].data.amount,
      orders[0].data.aToB,
      orders[0].data.tickIndex,
      fusionPool.data,
    );
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
    const tick = maybeTickToFacade(
      tickArray.data.ticks[(limitOrder.tickIndex - startTickIndex) / fusionPool.data.tickSpacing],
    );
    expect(tick.age).toEqual(2n);
    expect(tick.openOrdersInput).toEqual(0n);
    expect(tick.partFilledOrdersInput).toEqual(0n);
    expect(tick.partFilledOrdersRemainingInput).toEqual(0n);
    expect(tick.fulfilledAToBOrdersInput).toEqual(0n);
    expect(tick.fulfilledBToAOrdersInput).toEqual(1000000n);

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
