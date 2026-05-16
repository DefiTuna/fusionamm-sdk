//
// Copyright (c) Cryptic Dot
//
// Modification based on Orca Whirlpools (https://github.com/orca-so/whirlpools),
// originally licensed under the Apache License, Version 2.0, prior to February 26, 2025.
//
// Modifications licensed under FusionAMM SDK Source-Available License v1.0
// See the LICENSE file in the project root for license information.
//

import { fetchPosition, getPositionAddress } from "@crypticdot/fusionamm-client";
import type { Address } from "@solana/kit";
import { fetchToken } from "@solana-program/token-2022";
import assert from "assert";
import { beforeAll, describe, it } from "vitest";

import { decreaseLiquidityInstructions, DEFAULT_FUNDER, setDefaultFunder } from "../src";

import { rpc, sendTransaction, signer } from "./utils/mockRpc";
import { setupFusionPool, setupPosition } from "./utils/program";
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

const poolTypes = new Map([
  ["A-B", setupFusionPool],
  ["A-TEA", setupFusionPool],
  ["TEA-TEB", setupFusionPool],
  ["A-TEFee", setupFusionPool],
]);

const positionTypes = new Map([
  ["equally centered", { tickLower: -100, tickUpper: 100 }],
  ["one sided A", { tickLower: -100, tickUpper: -1 }],
  ["one sided B", { tickLower: 1, tickUpper: 100 }],
]);

describe("Decrease Liquidity", () => {
  const atas: Map<string, Address> = new Map();
  const initialLiquidity = 100_000n;
  const mints: Map<string, Address> = new Map();
  const pools: Map<string, Address> = new Map();
  const positions: Map<string, Address> = new Map();
  const tickSpacing = 64;
  const tokenBalance = 1_000_000n;

  beforeAll(async () => {
    for (const [name, setup] of mintTypes) {
      mints.set(name, await setup());
    }

    for (const [name, setup] of ataTypes) {
      const mint = mints.get(name)!;
      atas.set(name, await setup(mint, { amount: tokenBalance }));
    }

    for (const [name, setup] of poolTypes) {
      const [mintAKey, mintBKey] = name.split("-");
      const mintA = mints.get(mintAKey)!;
      const mintB = mints.get(mintBKey)!;
      pools.set(name, await setup(mintA, mintB, tickSpacing));
    }

    for (const [poolName, poolAddress] of pools) {
      for (const [positionTypeName, tickRange] of positionTypes) {
        const positionTE = await setupPosition(poolAddress, {
          ...tickRange,
          liquidity: initialLiquidity,
        });
        positions.set(`TE ${poolName} ${positionTypeName}`, positionTE);
      }
    }
  });

  const testDecreaseLiquidity = async (poolName: string, positionName: string) => {
    const [mintAName, mintBName] = poolName.split("-");
    const ataAAddress = atas.get(mintAName)!;
    const ataBAddress = atas.get(mintBName)!;
    const liquidityToDecrease = 10_000n;
    const positionMintAddress = positions.get(positionName)!;

    const { quote, instructions } = await decreaseLiquidityInstructions(rpc, positionMintAddress, {
      liquidity: liquidityToDecrease,
    });

    const tokenBeforeA = await fetchToken(rpc, ataAAddress);
    const tokenBeforeB = await fetchToken(rpc, ataBAddress);

    await sendTransaction(instructions);

    const tokenAfterA = await fetchToken(rpc, ataAAddress);
    const tokenAfterB = await fetchToken(rpc, ataBAddress);

    assert.strictEqual(quote.tokenEstA, tokenAfterA.data.amount - tokenBeforeA.data.amount);
    assert.strictEqual(quote.tokenEstB, tokenAfterB.data.amount - tokenBeforeB.data.amount);

    const positionAddress = await getPositionAddress(positionMintAddress);
    const position = await fetchPosition(rpc, positionAddress[0]);

    assert.strictEqual(initialLiquidity - quote.liquidityDelta, position.data.liquidity);
  };

  for (const poolName of poolTypes.keys()) {
    for (const positionTypeName of positionTypes.keys()) {
      const positionNameTE = `TE ${poolName} ${positionTypeName}`;
      it(`Should decrease liquidity for ${positionNameTE}`, async () => {
        await testDecreaseLiquidity(poolName, positionNameTE);
      });
    }
  }

  it("Should throw an error if the signer is not valid", async () => {
    const liquidityToDecrease = 10_000n;

    setDefaultFunder(DEFAULT_FUNDER);

    await assert.rejects(
      decreaseLiquidityInstructions(rpc, positions.get("A-B equally centered")!, { liquidity: liquidityToDecrease }),
    );

    setDefaultFunder(signer);
  });
});
