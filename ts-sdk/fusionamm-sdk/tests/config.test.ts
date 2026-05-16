//
// Copyright (c) Cryptic Dot
//
// Modification based on Orca Whirlpools (https://github.com/orca-so/whirlpools),
// originally licensed under the Apache License, Version 2.0, prior to February 26, 2025.
//
// Modifications licensed under FusionAMM SDK Source-Available License v1.0
// See the LICENSE file in the project root for license information.
//

import { createKeyPairSignerFromPrivateKeyBytes } from "@solana/kit";
import assert from "assert";
import { afterAll, describe, it } from "vitest";

import {
  DEFAULT_ADDRESS,
  DEFAULT_NATIVE_MINT_WRAPPING_STRATEGY,
  DEFAULT_SLIPPAGE_TOLERANCE_BPS,
  FUNDER,
  NATIVE_MINT_WRAPPING_STRATEGY,
  resetConfiguration,
  setDefaultFunder,
  setDefaultSlippageToleranceBps,
  setNativeMintWrappingStrategy,
  SLIPPAGE_TOLERANCE_BPS,
} from "../src";

// Tests in order, which is important here

describe("Configuration", () => {
  afterAll(() => {
    resetConfiguration();
  });

  it("Should be able to set default funder to an address", () => {
    setDefaultFunder(DEFAULT_ADDRESS);
    assert.strictEqual(FUNDER.address, DEFAULT_ADDRESS);
  });

  it("Should be able to set default funder to a signer", async () => {
    const bytes = new Uint8Array(32);
    const signer = await createKeyPairSignerFromPrivateKeyBytes(bytes);
    setDefaultFunder(signer);
    assert.strictEqual(FUNDER.address, signer.address);
  });

  it("Should be able to set the default slippage tolerance", () => {
    setDefaultSlippageToleranceBps(200);
    assert.strictEqual(SLIPPAGE_TOLERANCE_BPS, 200);
  });

  it("Should be able to set the native mint wrapping strategy", () => {
    setNativeMintWrappingStrategy("ata");
    assert.strictEqual(NATIVE_MINT_WRAPPING_STRATEGY, "ata");
  });

  it("Should be able to reset the configuration", () => {
    resetConfiguration();
    assert.strictEqual(FUNDER.address, DEFAULT_ADDRESS);
    assert.strictEqual(SLIPPAGE_TOLERANCE_BPS, DEFAULT_SLIPPAGE_TOLERANCE_BPS);
    assert.strictEqual(NATIVE_MINT_WRAPPING_STRATEGY, DEFAULT_NATIVE_MINT_WRAPPING_STRATEGY);
  });
});
