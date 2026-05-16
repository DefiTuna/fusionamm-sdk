//
// Copyright (c) Cryptic Dot
//
// Modification based on Orca Whirlpools (https://github.com/orca-so/whirlpools),
// originally licensed under the Apache License, Version 2.0, prior to February 26, 2025.
//
// Modifications licensed under FusionAMM SDK Source-Available License v1.0
// See the LICENSE file in the project root for license information.
//

import type { ProgramDerivedAddress } from "@solana/kit";
import { getProgramDerivedAddress } from "@solana/kit";

import { FUSIONAMM_PROGRAM_ADDRESS } from "../generated";

export async function getFusionPoolsConfigAddress(): Promise<ProgramDerivedAddress> {
  return await getProgramDerivedAddress({
    programAddress: FUSIONAMM_PROGRAM_ADDRESS,
    seeds: ["config"],
  });
}
