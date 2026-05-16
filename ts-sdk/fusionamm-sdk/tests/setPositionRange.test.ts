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
  fetchPosition,
  FUSIONAMM_ERROR__SET_RANGE_FOR_NON_EMPTY_POSITION,
  getPositionAddress,
  getSetPositionRangeInstruction,
} from "@crypticdot/fusionamm-client";
import { Address } from "@solana/kit";
import { findAssociatedTokenPda } from "@solana-program/token";
import { TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import assert from "assert";
import { beforeAll, describe, expect, it } from "vitest";

import { decreaseLiquidityInstructions } from "../src";

import { rpc, sendTransaction, signer } from "./utils/mockRpc";
import { setupFusionPool, setupPosition } from "./utils/program";
import { setupAta, setupMint } from "./utils/token";

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

  const setPositionRange = async (args: { positionMint: Address; tickLowerIndex: number; tickUpperIndex: number }) => {
    const ix = getSetPositionRangeInstruction({
      fusionPool: pool,
      position: (await getPositionAddress(args.positionMint))[0],
      positionAuthority: signer,
      positionTokenAccount: (
        await findAssociatedTokenPda({
          owner: signer.address,
          mint: args.positionMint,
          tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
        })
      )[0],
      tickLowerIndex: args.tickLowerIndex,
      tickUpperIndex: args.tickUpperIndex,
    });
    await sendTransaction([ix]);

    const positionAddress = await getPositionAddress(args.positionMint);
    const position = await fetchPosition(rpc, positionAddress[0]);

    expect(position.data.tickLowerIndex).toEqual(args.tickLowerIndex);
    expect(position.data.tickUpperIndex).toEqual(args.tickUpperIndex);
  };

  it("Fails to set a new range for a position with liquidity", async () => {
    const positionMint = await setupPosition(pool, { tickLower: -100, tickUpper: 100, liquidity: 10000n });

    await assert.rejects(setPositionRange({ positionMint, tickLowerIndex: -256, tickUpperIndex: 256 }), err => {
      expect((err as Error).toString()).contain(
        `custom program error: ${"0x" + FUSIONAMM_ERROR__SET_RANGE_FOR_NON_EMPTY_POSITION.toString(16)}`,
      );
      return true;
    });
  });

  it("Set range for an empty position", async () => {
    const positionMint = await setupPosition(pool, { tickLower: -100, tickUpper: 100, liquidity: 10000n });

    const { instructions } = await decreaseLiquidityInstructions(rpc, positionMint, { liquidity: 10000n });
    await sendTransaction(instructions);

    await setPositionRange({ positionMint, tickLowerIndex: -256, tickUpperIndex: 256 });
  });
});
