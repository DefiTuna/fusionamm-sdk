//
// Copyright (c) Cryptic Dot
//
// Modification based on Orca Whirlpools (https://github.com/orca-so/whirlpools),
// originally licensed under the Apache License, Version 2.0, prior to February 26, 2025.
//
// Modifications licensed under FusionAMM SDK Source-Available License v1.0
// See the LICENSE file in the project root for license information.
//

import {describe, it, beforeAll} from "vitest";
import type {Address} from "@solana/kit";
import {assertAccountExists} from "@solana/kit";
import {openFullRangePositionInstructions, openPositionInstructions} from "../src/increaseLiquidity";
import {rpc, sendTransaction} from "./utils/mockRpc";
import {fetchMaybePosition, getPositionAddress} from "@crypticdot/fusionamm-client";
import assert from "assert";
import {getFullRangeTickIndexes, getInitializableTickIndex, priceToTickIndex} from "@crypticdot/fusionamm-core";
import {ataTypes, mintTypes, poolTypes} from "./utils/poolMatrix";

describe("Open Position Instructions", () => {
  const tickSpacing = 64;
  const tokenBalance = 1_000_000n;
  const mints: Map<string, Address> = new Map();
  const atas: Map<string, Address> = new Map();
  const pools: Map<string, Address> = new Map();

  beforeAll(async () => {
    for (const [name, setup] of mintTypes) {
      mints.set(name, await setup());
    }

    for (const [name, setup] of ataTypes) {
      const mint = mints.get(name)!;
      atas.set(name, await setup(mint, {amount: tokenBalance}));
    }

    for (const [name, setup] of poolTypes) {
      const [mintAKey, mintBKey] = name.split("-");
      const mintA = mints.get(mintAKey)!;
      const mintB = mints.get(mintBKey)!;
      pools.set(name, await setup(mintA, mintB, tickSpacing));
    }
  });

  const testOpenPositionInstructions = async (poolName: string, lowerPrice: number, upperPrice: number) => {
    const fusionPool = pools.get(poolName)!;
    const param = {liquidity: 10_000n};

    const {instructions, positionMint} = await openPositionInstructions(
      rpc,
      fusionPool,
      param,
      {price: lowerPrice},
      {price: upperPrice},
    );

    const positionAddress = await getPositionAddress(positionMint);
    const positionBefore = await fetchMaybePosition(rpc, positionAddress[0]);

    await sendTransaction(instructions);

    const positionAfter = await fetchMaybePosition(rpc, positionAddress[0]);
    assert.strictEqual(positionBefore.exists, false);
    assertAccountExists(positionAfter);

    const expectedTickLowerIndex = priceToTickIndex(lowerPrice, 6, 6);
    const expectedTickUpperIndex = priceToTickIndex(upperPrice, 6, 6);
    const initializableLowerTickIndex = getInitializableTickIndex(expectedTickLowerIndex, tickSpacing, false);
    const initializableUpperTickIndex = getInitializableTickIndex(expectedTickUpperIndex, tickSpacing, true);

    assert.strictEqual(positionAfter.data.tickLowerIndex, initializableLowerTickIndex);
    assert.strictEqual(positionAfter.data.tickUpperIndex, initializableUpperTickIndex);
  };

  const testOpenFullRangePositionInstructions = async (poolName: string) => {
    const fusionPool = pools.get(poolName)!;
    const param = {liquidity: 10_000n};

    const {instructions, positionMint} = await openFullRangePositionInstructions(rpc, fusionPool, param);

    const positionAddress = await getPositionAddress(positionMint);
    const positionBefore = await fetchMaybePosition(rpc, positionAddress[0]);

    await sendTransaction(instructions);

    const positionAfter = await fetchMaybePosition(rpc, positionAddress[0]);
    assert.strictEqual(positionBefore.exists, false);
    assertAccountExists(positionAfter);

    const tickRange = getFullRangeTickIndexes(tickSpacing);
    const initializableLowerTickIndex = getInitializableTickIndex(tickRange.tickLowerIndex, tickSpacing, false);
    const initializableUpperTickIndex = getInitializableTickIndex(tickRange.tickUpperIndex, tickSpacing, true);

    assert.strictEqual(positionAfter.data.tickLowerIndex, initializableLowerTickIndex);
    assert.strictEqual(positionAfter.data.tickUpperIndex, initializableUpperTickIndex);
  };

  for (const poolName of poolTypes.keys()) {
    it(`Should open a position with a specific price range for ${poolName}`, async () => {
      await testOpenPositionInstructions(poolName, 0.95, 1.05);
    });

    it(`Should open a full-range position for ${poolName}`, async () => {
      await testOpenFullRangePositionInstructions(poolName);
    });
  }

  it("Should compute correct initialization costs if both tick arrays are already initialized", async () => {
    const param = {liquidity: 10_000n};

    const {initializationCost} = await openPositionInstructions(
      rpc,
      pools.get("A-B")!,
      param,
      {price: 0.95},
      {price: 1.05},
    );

    assert.strictEqual(initializationCost, 0n);
  });

  it("Should compute correct initialization costs if 1 tick array is already initialized", async () => {
    const param = {liquidity: 10_000n};

    const {initializationCost} = await openPositionInstructions(
      rpc,
      pools.get("A-B")!,
      param,
      {price: 0.05},
      {price: 1.05},
    );

    assert.strictEqual(initializationCost, 70407360n);
  });

  it("Should compute correct initialization costs if no tick arrays are already initialized", async () => {
    const param = {liquidity: 10_000n};

    const {initializationCost} = await openPositionInstructions(
      rpc,
      pools.get("A-B")!,
      param,
      {price: 0.01},
      {price: 5},
    );

    assert.strictEqual(initializationCost, 140814720n);
  });
});
