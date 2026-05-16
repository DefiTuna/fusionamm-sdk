//
// Copyright (c) Cryptic Dot
//
// Licensed under FusionAMM SDK Source-Available License v1.0
// See the LICENSE file in the project root for license information.
//

import type { Address, ProgramDerivedAddress } from "@solana/kit";
import { getAddressEncoder, getProgramDerivedAddress } from "@solana/kit";

import { FUSIONAMM_PROGRAM_ADDRESS } from "../generated";

export async function getLimitOrderAddress(limitOrderMint: Address): Promise<ProgramDerivedAddress> {
  return await getProgramDerivedAddress({
    programAddress: FUSIONAMM_PROGRAM_ADDRESS,
    seeds: ["limit_order", getAddressEncoder().encode(limitOrderMint)],
  });
}
