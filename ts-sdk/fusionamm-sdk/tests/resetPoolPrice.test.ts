//
// Copyright (c) Cryptic Dot
//
// Modification based on Orca Whirlpools (https://github.com/orca-so/whirlpools),
// originally licensed under the Apache License, Version 2.0, prior to February 26, 2025.
//
// Modifications licensed under FusionAMM SDK Source-Available License v1.0
// See the LICENSE file in the project root for license information.
//

import { FUSIONAMM_ERROR__RESET_PRICE_FOR_NON_EMPTY_POOL } from "@crypticdot/fusionamm-client";
import { Address } from "@solana/kit";
import assert from "assert";
import { beforeAll, describe, expect, it } from "vitest";
import { rpc, sendTransaction } from "./utils/mockRpc";
import { setupAta, setupMint } from "./utils/token";
import { setupPosition, setupFusionPool } from "./utils/program";
import { resetPoolPriceInstruction } from "../src";

describe("Set Position Range", () => {
  let mintA: Address;
  let mintB: Address;
  let pool: Address;

  beforeAll(async () => {
    mintA = await setupMint();
    mintB = await setupMint();
    await setupAta(mintA, { amount: 500e9 });
    await setupAta(mintB, { amount: 500e9 });
    pool = await setupFusionPool(mintA, mintB, 128);
  });

  it("Reset the pool price", async () => {
    const ix = await resetPoolPriceInstruction(rpc, pool, 12121234532524n);
    await sendTransaction([ix]);
  });

  it("Fails to reset the price for a pool with liquidity", async () => {
    await setupPosition(pool, { tickLower: -100, tickUpper: 100, liquidity: 10000n });

    const ix = await resetPoolPriceInstruction(rpc, pool, 22121234532524n);
    await assert.rejects(sendTransaction([ix]), err => {
      expect((err as Error).toString()).contain(
        `custom program error: ${"0x" + FUSIONAMM_ERROR__RESET_PRICE_FOR_NON_EMPTY_POOL.toString(16)}`,
      );
      return true;
    });
  });
});
