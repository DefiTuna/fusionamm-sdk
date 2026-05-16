//
// Copyright (c) Cryptic Dot
//
// Modification based on Orca Whirlpools (https://github.com/orca-so/whirlpools),
// originally licensed under the Apache License, Version 2.0, prior to February 26, 2025.
//
// Modifications licensed under FusionAMM SDK Source-Available License v1.0
// See the LICENSE file in the project root for license information.
//

import { lamports } from "@solana/kit";
import type { SysvarRent } from "@solana/sysvars";
import assert from "assert";
import { describe, it } from "vitest";

import { calculateMinimumBalanceForRentExemption } from "../src/sysvar";

describe("Sysvar", () => {
  const rent: SysvarRent = {
    lamportsPerByteYear: lamports(10n),
    exemptionThreshold: 1.0,
    burnPercent: 0,
  };

  it("Should calculate the correct minimum balance for a token account", () => {
    const tokenSize = 165;
    const calcultatedMinimumBalance = calculateMinimumBalanceForRentExemption(rent, tokenSize);

    const expectedMinimumBalance = lamports(2930n);
    assert.strictEqual(calcultatedMinimumBalance, expectedMinimumBalance);
  });

  it("Should handle zero data size", () => {
    const dataSize = 0;
    const result = calculateMinimumBalanceForRentExemption(rent, dataSize);

    const expectedMinimumBalance = lamports(1280n);
    assert.strictEqual(result, expectedMinimumBalance);
  });
});
