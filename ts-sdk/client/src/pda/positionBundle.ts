//
// Copyright (c) Cryptic Dot
//
// Modification based on Orca Whirlpools (https://github.com/orca-so/whirlpools),
// originally licensed under the Apache License, Version 2.0, prior to February 26, 2025.
//
// Modifications licensed under FusionAMM SDK Source-Available License v1.0
// See the LICENSE file in the project root for license information.
//

import type { Address, ProgramDerivedAddress } from "@solana/kit";
import { getAddressEncoder, getProgramDerivedAddress } from "@solana/kit";
import { FUSIONAMM_PROGRAM_ADDRESS } from "../generated/programs/fusionamm";

export async function getPositionBundleAddress(positionBundleMint: Address): Promise<ProgramDerivedAddress> {
  return await getProgramDerivedAddress({
    programAddress: FUSIONAMM_PROGRAM_ADDRESS,
    seeds: ["position_bundle", getAddressEncoder().encode(positionBundleMint)],
  });
}

export async function getBundledPositionAddress(
  positionBundleAddress: Address,
  bundleIndex: number,
): Promise<ProgramDerivedAddress> {
  return await getProgramDerivedAddress({
    programAddress: FUSIONAMM_PROGRAM_ADDRESS,
    seeds: ["bundled_position", getAddressEncoder().encode(positionBundleAddress), Buffer.from(bundleIndex.toString())],
  });
}
