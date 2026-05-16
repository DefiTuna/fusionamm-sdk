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
import { getAddressEncoder, getBase58Decoder, getI32Encoder } from "@solana/kit";

import { FUSIONAMM_PROGRAM_ADDRESS, getTickArrayDecoder, TICK_ARRAY_DISCRIMINATOR, TickArray } from "../generated";

import { fetchDecodedProgramAccounts } from "./utils";

export type TickArrayFilter = GetProgramAccountsMemcmpFilter & {
  readonly __kind: unique symbol;
};

export function tickArrayStartTickIndexFilter(startTickIndex: number): TickArrayFilter {
  return {
    memcmp: {
      offset: 8n,
      bytes: getBase58Decoder().decode(getI32Encoder().encode(startTickIndex)),
      encoding: "base58",
    },
  } as TickArrayFilter;
}

export function tickArrayFusionPoolFilter(address: Address): TickArrayFilter {
  return {
    memcmp: {
      offset: 12n,
      bytes: getBase58Decoder().decode(getAddressEncoder().encode(address)),
      encoding: "base58",
    },
  } as TickArrayFilter;
}

export async function fetchAllTickArrayWithFilter(
  rpc: Rpc<GetProgramAccountsApi>,
  ...filters: TickArrayFilter[]
): Promise<Account<TickArray>[]> {
  const discriminator = getBase58Decoder().decode(TICK_ARRAY_DISCRIMINATOR);
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
    getTickArrayDecoder(),
  );
}
