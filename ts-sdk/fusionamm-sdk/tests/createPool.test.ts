//
// Copyright (c) Cryptic Dot
//
// Modification based on Orca Whirlpools (https://github.com/orca-so/whirlpools),
// originally licensed under the Apache License, Version 2.0, prior to February 26, 2025.
//
// Modifications licensed under FusionAMM SDK Source-Available License v1.0
// See the LICENSE file in the project root for license information.
//

import { fetchMaybeFusionPool } from "@crypticdot/fusionamm-client";
import { priceToSqrtPrice } from "@crypticdot/fusionamm-core";
import { Address } from "@solana/kit";
import { assertAccountExists } from "@solana/kit";
import assert from "assert";
import { beforeAll, describe, it } from "vitest";

import { createFusionPoolInstructions, DEFAULT_FUNDER, setDefaultFunder } from "../src";

import { rpc, sendTransaction, signer } from "./utils/mockRpc";
import { setupMint } from "./utils/token";
import { setupMintTE, setupMintTEFee } from "./utils/tokenExtensions";

describe("Create Pool", () => {
  let mintA: Address;
  let mintB: Address;
  let mintTEA: Address;
  let mintTEB: Address;
  let mintTEFee: Address;
  const tickSpacing = 64;

  beforeAll(async () => {
    mintA = await setupMint();
    mintB = await setupMint();
    mintTEA = await setupMintTE();
    mintTEB = await setupMintTE();
    mintTEFee = await setupMintTEFee();
  });

  it("Should throw an error if funder is not set", async () => {
    setDefaultFunder(DEFAULT_FUNDER);
    await assert.rejects(createFusionPoolInstructions(rpc, mintA, mintB, tickSpacing, 1));
    setDefaultFunder(signer);
  });

  it("Should throw an error if token mints are not ordered correctly", async () => {
    await assert.rejects(createFusionPoolInstructions(rpc, mintB, mintA, tickSpacing, 1));
  });

  it("Should create concentrated liquidity pool", async () => {
    const price = 10;
    const feeRate = 1000;
    const sqrtPrice = priceToSqrtPrice(price, 6, 6);

    const { instructions, poolAddress, initializationCost } = await createFusionPoolInstructions(
      rpc,
      mintA,
      mintB,
      tickSpacing,
      feeRate,
      price,
    );

    const balanceBefore = await rpc.getBalance(signer.address).send();
    const poolBefore = await fetchMaybeFusionPool(rpc, poolAddress);
    assert.strictEqual(poolBefore.exists, false);

    await sendTransaction(instructions);

    const poolAfter = await fetchMaybeFusionPool(rpc, poolAddress);
    const balanceAfter = await rpc.getBalance(signer.address).send();
    const balanceChange = balanceBefore.value - balanceAfter.value;
    const txFee = 15000n; // 3 signing accounts * 5000 lamports
    const minRentExempt = balanceChange - txFee;

    assertAccountExists(poolAfter);
    assert.strictEqual(initializationCost, minRentExempt);
    assert.strictEqual(sqrtPrice, poolAfter.data.sqrtPrice);
    assert.strictEqual(feeRate, poolAfter.data.feeRate);
    assert.strictEqual(mintA, poolAfter.data.tokenMintA);
    assert.strictEqual(mintB, poolAfter.data.tokenMintB);
    assert.strictEqual(tickSpacing, poolAfter.data.tickSpacing);
  });

  it("Should create concentrated liquidity pool with 1 TE token (without extension)", async () => {
    const price = 10;
    const feeRate = 1000;
    const sqrtPrice = priceToSqrtPrice(price, 6, 6);

    const { instructions, poolAddress, initializationCost } = await createFusionPoolInstructions(
      rpc,
      mintA,
      mintTEA,
      tickSpacing,
      feeRate,
      price,
    );

    const balanceBefore = await rpc.getBalance(signer.address).send();
    const poolBefore = await fetchMaybeFusionPool(rpc, poolAddress);
    assert.strictEqual(poolBefore.exists, false);

    await sendTransaction(instructions);

    const poolAfter = await fetchMaybeFusionPool(rpc, poolAddress);
    const balanceAfter = await rpc.getBalance(signer.address).send();
    const balanceChange = balanceBefore.value - balanceAfter.value;
    const txFee = 15000n; // 3 signing accounts * 5000 lamports
    const minRentExempt = balanceChange - txFee;

    assertAccountExists(poolAfter);
    assert.strictEqual(initializationCost, minRentExempt);
    assert.strictEqual(sqrtPrice, poolAfter.data.sqrtPrice);
    assert.strictEqual(feeRate, poolAfter.data.feeRate);
    assert.strictEqual(mintA, poolAfter.data.tokenMintA);
    assert.strictEqual(mintTEA, poolAfter.data.tokenMintB);
    assert.strictEqual(tickSpacing, poolAfter.data.tickSpacing);
  });

  it("Should create concentrated liquidity pool with 2 TE tokens (without extensions)", async () => {
    const price = 10;
    const feeRate = 1000;
    const sqrtPrice = priceToSqrtPrice(price, 6, 6);

    const { instructions, poolAddress, initializationCost } = await createFusionPoolInstructions(
      rpc,
      mintTEA,
      mintTEB,
      tickSpacing,
      feeRate,
      price,
    );

    const balanceBefore = await rpc.getBalance(signer.address).send();
    const poolBefore = await fetchMaybeFusionPool(rpc, poolAddress);
    assert.strictEqual(poolBefore.exists, false);

    await sendTransaction(instructions);

    const poolAfter = await fetchMaybeFusionPool(rpc, poolAddress);
    const balanceAfter = await rpc.getBalance(signer.address).send();
    const balanceChange = balanceBefore.value - balanceAfter.value;
    const txFee = 15000n; // 3 signing accounts * 5000 lamports
    const minRentExempt = balanceChange - txFee;

    assertAccountExists(poolAfter);
    assert.strictEqual(initializationCost, minRentExempt);
    assert.strictEqual(sqrtPrice, poolAfter.data.sqrtPrice);
    assert.strictEqual(feeRate, poolAfter.data.feeRate);
    assert.strictEqual(mintTEA, poolAfter.data.tokenMintA);
    assert.strictEqual(mintTEB, poolAfter.data.tokenMintB);
    assert.strictEqual(tickSpacing, poolAfter.data.tickSpacing);
  });

  it("Should create concentrated liquidity pool with 1 TE token (with Transfer Fee extension)", async () => {
    const price = 10;
    const feeRate = 1000;
    const sqrtPrice = priceToSqrtPrice(price, 6, 6);

    const { instructions, poolAddress, initializationCost } = await createFusionPoolInstructions(
      rpc,
      mintA,
      mintTEFee,
      tickSpacing,
      feeRate,
      price,
    );

    const balanceBefore = await rpc.getBalance(signer.address).send();
    const poolBefore = await fetchMaybeFusionPool(rpc, poolAddress);
    assert.strictEqual(poolBefore.exists, false);

    await sendTransaction(instructions);

    const poolAfter = await fetchMaybeFusionPool(rpc, poolAddress);
    const balanceAfter = await rpc.getBalance(signer.address).send();
    const balanceChange = balanceBefore.value - balanceAfter.value;
    const txFee = 15000n; // 3 signing accounts * 5000 lamports
    const minRentExempt = balanceChange - txFee;

    assertAccountExists(poolAfter);
    assert.strictEqual(initializationCost, minRentExempt);
    assert.strictEqual(sqrtPrice, poolAfter.data.sqrtPrice);
    assert.strictEqual(feeRate, poolAfter.data.feeRate);
    assert.strictEqual(mintA, poolAfter.data.tokenMintA);
    assert.strictEqual(mintTEFee, poolAfter.data.tokenMintB);
    assert.strictEqual(tickSpacing, poolAfter.data.tickSpacing);
  });
});
