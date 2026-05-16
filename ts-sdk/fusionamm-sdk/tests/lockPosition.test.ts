//
// Copyright (c) Cryptic Dot
//
// Modification based on Orca Whirlpools (https://github.com/orca-so/whirlpools),
// originally licensed under the Apache License, Version 2.0, prior to February 26, 2025.
//
// Modifications licensed under FusionAMM SDK Source-Available License v1.0
// See the LICENSE file in the project root for license information.
//

import { FUSIONAMM_ERROR__POSITION_LOCKED, PositionLockType } from "@crypticdot/fusionamm-client";
import { Address } from "@solana/kit";
import assert from "assert";
import { beforeAll, describe, expect, it } from "vitest";

import { decreaseLiquidityInstructions, lockPositionInstruction } from "../src";

import { rpc, sendTransaction } from "./utils/mockRpc.ts";
import { setupFusionPool, setupPosition } from "./utils/program";
import { setupAta, setupMint } from "./utils/token";

describe("Lock Position", () => {
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

  it("Fails decrease liquidity of the locked position", async () => {
    const positionMint = await setupPosition(pool, { tickLower: -100, tickUpper: 100, liquidity: 10000n });

    const lockIx = await lockPositionInstruction(rpc, positionMint, PositionLockType.Permanent);
    await sendTransaction([lockIx]);

    const { instructions } = await decreaseLiquidityInstructions(rpc, positionMint, {
      liquidity: 1000n,
    });
    await assert.rejects(sendTransaction(instructions), err => {
      expect((err as Error).toString()).contain(
        `custom program error: ${"0x" + FUSIONAMM_ERROR__POSITION_LOCKED.toString(16)}`,
      );
      return true;
    });
  });
});
