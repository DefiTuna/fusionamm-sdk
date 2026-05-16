//
// Copyright (c) Cryptic Dot
//
// Modification based on Orca Whirlpools (https://github.com/orca-so/whirlpools),
// originally licensed under the Apache License, Version 2.0, prior to February 26, 2025.
//
// Modifications licensed under FusionAMM SDK Source-Available License v1.0
// See the LICENSE file in the project root for license information.
//

import { Address, generateKeyPairSigner } from "@solana/kit";
import { assert, beforeAll, describe, it } from "vitest";

import { fetchPositionsForOwner, fetchPositionsInFusionPool } from "../src";

import { rpc, signer } from "./utils/mockRpc";
import { setupFusionPool, setupPosition, setupPositionBundle } from "./utils/program";
import { setupAta, setupMint } from "./utils/token";

describe("Fetch Position", () => {
  let mintA: Address;
  let mintB: Address;
  let pool: Address;

  beforeAll(async () => {
    mintA = await setupMint();
    mintB = await setupMint();
    await setupAta(mintA, { amount: 500e9 });
    await setupAta(mintB, { amount: 500e9 });
    pool = await setupFusionPool(mintA, mintB, 128);
    await setupPosition(pool);
    await setupPositionBundle(pool);
  });

  // TODO: enable this when solana-bankrun supports gpa
  it.skip("Should fetch all positions for an address", async () => {
    const positions = await fetchPositionsForOwner(rpc, signer.address);
    assert.strictEqual(positions.length, 5);
  });

  // TODO: enable this when solana-bankrun supports gpa
  it.skip("Should fetch no positions for a different address", async () => {
    const other = await generateKeyPairSigner();
    const positions = await fetchPositionsForOwner(rpc, other.address);
    assert.strictEqual(positions.length, 0);
  });

  // TODO: enable this when solana-bankrun supports gpa
  it.skip("Should fetch positions for a fusionPool", async () => {
    const positions = await fetchPositionsInFusionPool(rpc, pool);
    assert.strictEqual(positions.length, 3);
  });
});
