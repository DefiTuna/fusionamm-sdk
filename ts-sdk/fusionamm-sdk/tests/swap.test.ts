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
import { MEMO_PROGRAM_ADDRESS } from "@solana-program/memo";
import { fetchAllMint, fetchToken } from "@solana-program/token-2022";
import { AccountRole, type Address, type IInstruction } from "@solana/kit";
import assert from "assert";
import { beforeAll, describe, it } from "vitest";
import { fetchTickArrayOrDefault, swapInstructions } from "../src/swap";
import { rpc, sendTransaction, signer } from "./utils/mockRpc";
import { setupPosition } from "./utils/program";
import { ataTypes, mintTypes, poolTypes } from "./utils/poolMatrix";

const positionTypes = new Map([
  ["equally centered", { tickLower: -100, tickUpper: 100 }],
  ["one sided A", { tickLower: -100, tickUpper: -1 }],
  ["one sided B", { tickLower: 1, tickUpper: 100 }],
]);

describe("Swap", () => {
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

  const assertSwapInstructionShape = async (
    instructions: IInstruction[],
    poolAddress: Address,
    mintAName: string,
    mintBName: string,
  ) => {
    const fusionPool = await fetchFusionPool(rpc, poolAddress);
    const [tokenA, tokenB] = await fetchAllMint(rpc, [fusionPool.data.tokenMintA, fusionPool.data.tokenMintB]);
    const tickArrays = await fetchTickArrayOrDefault(rpc, fusionPool);
    const swapInstruction = instructions.find(ix => ix.programAddress === fusionPool.programAddress);

    assert(swapInstruction, "Expected a FusionAMM swap instruction");

    const instructionAddresses = new Map(swapInstruction.accounts.map(account => [account.address, account.role]));

    for (const address of [
      tokenA.programAddress,
      tokenB.programAddress,
      MEMO_PROGRAM_ADDRESS,
      signer.address,
      fusionPool.address,
      fusionPool.data.tokenMintA,
      fusionPool.data.tokenMintB,
      atas.get(mintAName)!,
      atas.get(mintBName)!,
      fusionPool.data.tokenVaultA,
      fusionPool.data.tokenVaultB,
      ...tickArrays.map(x => x.address),
    ]) {
      assert(instructionAddresses.has(address), `Missing swap account ${address}`);
    }

    assert.strictEqual(
      tickArrays.filter(x => instructionAddresses.has(x.address)).length,
      5,
      "Expected all 5 tick arrays on the swap instruction",
    );
    assert.strictEqual(instructionAddresses.get(tickArrays[3].address), AccountRole.WRITABLE);
    assert.strictEqual(instructionAddresses.get(tickArrays[4].address), AccountRole.WRITABLE);
  };

  const testSwapAExactIn = async (poolName: string) => {
    const [mintAName, mintBName] = poolName.split("-");
    const mintAAddress = mints.get(mintAName)!;
    const ataAAddress = atas.get(mintAName)!;
    const ataBAddress = atas.get(mintBName)!;
    const poolAddress = pools.get(poolName)!;

    let tokenABefore = await fetchToken(rpc, ataAAddress);
    let tokenBBefore = await fetchToken(rpc, ataBAddress);

    const { instructions, quote } = await swapInstructions(
      rpc,
      { inputAmount: 100n, mint: mintAAddress },
      poolAddress,
      100, // slippage
    );
    await assertSwapInstructionShape(instructions, poolAddress, mintAName, mintBName);
    await sendTransaction(instructions);

    let tokenAAfter = await fetchToken(rpc, ataAAddress);
    let tokenBAfter = await fetchToken(rpc, ataBAddress);

    assert.strictEqual(-quote.tokenIn, tokenAAfter.data.amount - tokenABefore.data.amount);

    assert.strictEqual(quote.tokenEstOut, tokenBAfter.data.amount - tokenBBefore.data.amount);
  };

  const testSwapAExactOut = async (poolName: string) => {
    const [mintAName, mintBName] = poolName.split("-");
    const mintAAddress = mints.get(mintAName)!;
    const ataAAddress = atas.get(mintAName)!;
    const ataBAddress = atas.get(mintBName)!;
    const poolAddress = pools.get(poolName)!;

    let tokenABefore = await fetchToken(rpc, ataAAddress);
    let tokenBBefore = await fetchToken(rpc, ataBAddress);

    const { instructions, quote } = await swapInstructions(
      rpc,
      { outputAmount: 100n, mint: mintAAddress },
      poolAddress,
      100, // slippage
    );
    await assertSwapInstructionShape(instructions, poolAddress, mintAName, mintBName);
    await sendTransaction(instructions);

    let tokenAAfter = await fetchToken(rpc, ataAAddress);
    let tokenBAfter = await fetchToken(rpc, ataBAddress);

    assert.strictEqual(quote.tokenOut, tokenAAfter.data.amount - tokenABefore.data.amount);

    assert.strictEqual(-quote.tokenEstIn, tokenBAfter.data.amount - tokenBBefore.data.amount);
  };

  const testSwapBExactIn = async (poolName: string) => {
    const [mintAName, mintBName] = poolName.split("-");
    const mintBAddress = mints.get(mintBName)!;
    const ataAAddress = atas.get(mintAName)!;
    const ataBAddress = atas.get(mintBName)!;
    const poolAddress = pools.get(poolName)!;

    let tokenABefore = await fetchToken(rpc, ataAAddress);
    let tokenBBefore = await fetchToken(rpc, ataBAddress);

    const { instructions, quote } = await swapInstructions(
      rpc,
      { inputAmount: 100n, mint: mintBAddress },
      poolAddress,
      100, // slippage
    );
    await assertSwapInstructionShape(instructions, poolAddress, mintAName, mintBName);
    await sendTransaction(instructions);

    let tokenAAfter = await fetchToken(rpc, ataAAddress);
    let tokenBAfter = await fetchToken(rpc, ataBAddress);

    assert.strictEqual(quote.tokenEstOut, tokenAAfter.data.amount - tokenABefore.data.amount);

    assert.strictEqual(-quote.tokenIn, tokenBAfter.data.amount - tokenBBefore.data.amount);
  };

  const testSwapBExactOut = async (poolName: string) => {
    const [mintAName, mintBName] = poolName.split("-");
    const mintBAddress = mints.get(mintBName)!;
    const ataAAddress = atas.get(mintAName)!;
    const ataBAddress = atas.get(mintBName)!;
    const poolAddress = pools.get(poolName)!;

    let tokenABefore = await fetchToken(rpc, ataAAddress);
    let tokenBBefore = await fetchToken(rpc, ataBAddress);

    const { instructions, quote } = await swapInstructions(
      rpc,
      { outputAmount: 100n, mint: mintBAddress },
      poolAddress,
      100, // slippage
    );
    await assertSwapInstructionShape(instructions, poolAddress, mintAName, mintBName);
    await sendTransaction(instructions);

    let tokenAAfter = await fetchToken(rpc, ataAAddress);
    let tokenBAfter = await fetchToken(rpc, ataBAddress);

    assert.strictEqual(-quote.tokenEstIn, tokenAAfter.data.amount - tokenABefore.data.amount);

    assert.strictEqual(quote.tokenOut, tokenBAfter.data.amount - tokenBBefore.data.amount);
  };

  for (const poolName of poolTypes.keys()) {
    it(`Should swap A to B in ${poolName} using A amount`, async () => {
      await testSwapAExactIn(poolName);
    });

    it(`Should swap B to A in ${poolName} using A amount`, async () => {
      await testSwapAExactOut(poolName);
    });

    it(`Should swap B to A in ${poolName} using B amount`, async () => {
      await testSwapBExactIn(poolName);
    });

    it(`Should swap A to B in ${poolName} using B amount`, async () => {
      await testSwapBExactOut(poolName);
    });
  }
});
