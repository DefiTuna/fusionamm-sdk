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
import {increaseLiquidityInstructions, DEFAULT_FUNDER, setDefaultFunder} from "../src";
import {rpc, signer, sendTransaction} from "./utils/mockRpc";
import {setupMint, setupAta} from "./utils/token";
import {fetchPosition, getPositionAddress} from "@crypticdot/fusionamm-client";
import {fetchToken} from "@solana-program/token-2022";
import type {Address} from "@solana/kit";
import assert from "assert";
import {setupPosition, setupFusionPool} from "./utils/program";
import {setupAtaTE, setupMintTE, setupMintTEFee} from "./utils/tokenExtensions";

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

const poolTypes = new Map([
  ["A-B", setupFusionPool],
  ["A-TEA", setupFusionPool],
  ["TEA-TEB", setupFusionPool],
  ["A-TEFee", setupFusionPool],
]);

const positionTypes = new Map([
  ["equally centered", {tickLower: -100, tickUpper: 100}],
  ["one sided A", {tickLower: -100, tickUpper: -1}],
  ["one sided B", {tickLower: 1, tickUpper: 100}],
]);

describe("Increase Liquidity Instructions", () => {
  const tickSpacing = 64;
  const tokenBalance = 1_000_000n;
  const atas: Map<string, Address> = new Map();
  const positions: Map<string, Address> = new Map();

  beforeAll(async () => {
    const mints: Map<string, Address> = new Map();
    for (const [name, setup] of mintTypes) {
      mints.set(name, await setup());
    }

    for (const [name, setup] of ataTypes) {
      const mint = mints.get(name)!;
      atas.set(name, await setup(mint, {amount: tokenBalance}));
    }

    const pools: Map<string, Address> = new Map();
    for (const [name, setup] of poolTypes) {
      const [mintAKey, mintBKey] = name.split("-");
      const mintA = mints.get(mintAKey)!;
      const mintB = mints.get(mintBKey)!;
      pools.set(name, await setup(mintA, mintB, tickSpacing));
    }

    for (const [poolName, poolAddress] of pools) {
      for (const [positionTypeName, tickRange] of positionTypes) {
        const positionTE = await setupPosition(poolAddress, tickRange);
        positions.set(`TE ${poolName} ${positionTypeName}`, positionTE);
      }
    }
  });

  const testIncreaseLiquidity = async (positionName: string, poolName: string) => {
    const positionMint = positions.get(positionName)!;
    const [mintAKey, mintBKey] = poolName.split("-");
    const ataA = atas.get(mintAKey)!;
    const ataB = atas.get(mintBKey)!;
    const param = {liquidity: 10_000n};

    const {quote, instructions} = await increaseLiquidityInstructions(rpc, positionMint, param);

    const tokenBeforeA = await fetchToken(rpc, ataA);
    const tokenBeforeB = await fetchToken(rpc, ataB);
    await sendTransaction(instructions);
    const positionAddress = await getPositionAddress(positionMint);
    const position = await fetchPosition(rpc, positionAddress[0]);
    const tokenAfterA = await fetchToken(rpc, ataA);
    const tokenAfterB = await fetchToken(rpc, ataB);
    const balanceChangeTokenA = tokenBeforeA.data.amount - tokenAfterA.data.amount;
    const balanceChangeTokenB = tokenBeforeB.data.amount - tokenAfterB.data.amount;

    assert.strictEqual(quote.tokenEstA, balanceChangeTokenA);
    assert.strictEqual(quote.tokenEstB, balanceChangeTokenB);
    assert.strictEqual(quote.liquidityDelta, position.data.liquidity);
  };

  for (const poolName of poolTypes.keys()) {
    for (const positionTypeName of positionTypes.keys()) {
      const positionNameTE = `TE ${poolName} ${positionTypeName}`;
      it(`Increase liquidity for ${positionNameTE}`, async () => {
        await testIncreaseLiquidity(positionNameTE, poolName);
      });
    }
  }

  it("Should throw error if authority is default address", async () => {
    const liquidity = 100_000n;
    setDefaultFunder(DEFAULT_FUNDER);
    await assert.rejects(
      increaseLiquidityInstructions(rpc, positions.keys().next().value! as Address, {
        liquidity,
      }),
    );
    setDefaultFunder(signer);
  });

  it("Should throw error increase liquidity amount by token is equal or greater than the token balance", async () => {
    const tokenAAmount = 1_000_000n;
    await assert.rejects(
      increaseLiquidityInstructions(rpc, positions.keys().next().value! as Address, {
        tokenA: tokenAAmount,
      }),
    );
  });
});
