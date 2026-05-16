//
// Copyright (c) Cryptic Dot
//
// Modification based on Orca Whirlpools (https://github.com/orca-so/whirlpools),
// originally licensed under the Apache License, Version 2.0, prior to February 26, 2025.
//
// Modifications licensed under FusionAMM SDK Source-Available License v1.0
// See the LICENSE file in the project root for license information.
//

import type { Account, Address, GetProgramAccountsApi, GetProgramAccountsMemcmpFilter, Rpc } from "@solana/kit";
import { getAddressEncoder, getBase58Decoder } from "@solana/kit";

import type { PositionBundle } from "../generated/accounts/positionBundle";
import { getPositionBundleDecoder, POSITION_BUNDLE_DISCRIMINATOR } from "../generated/accounts/positionBundle";
import { FUSIONAMM_PROGRAM_ADDRESS } from "../generated/programs/fusionamm";

import { fetchDecodedProgramAccounts } from "./utils";

export type PositionBundleFilter = GetProgramAccountsMemcmpFilter & {
  readonly __kind: unique symbol;
};

export function positionBundleMintFilter(address: Address): PositionBundleFilter {
  return {
    memcmp: {
      offset: 8n,
      bytes: getBase58Decoder().decode(getAddressEncoder().encode(address)),
      encoding: "base58",
    },
  } as PositionBundleFilter;
}

export async function fetchAllPositionBundleWithFilter(
  rpc: Rpc<GetProgramAccountsApi>,
  ...filters: PositionBundleFilter[]
): Promise<Account<PositionBundle>[]> {
  const discriminator = getBase58Decoder().decode(POSITION_BUNDLE_DISCRIMINATOR);
  const discriminatorFilter: GetProgramAccountsMemcmpFilter = {
    memcmp: {
      offset: 0n,
      bytes: discriminator,
      encoding: "base58",
    },
  };
  return fetchDecodedProgramAccounts(
    rpc,
    FUSIONAMM_PROGRAM_ADDRESS,
    [discriminatorFilter, ...filters],
    getPositionBundleDecoder(),
  );
}
