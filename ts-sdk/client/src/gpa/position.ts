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

import type { Position } from "../generated";
import { FUSIONAMM_PROGRAM_ADDRESS, getPositionDecoder, POSITION_DISCRIMINATOR } from "../generated";

import { fetchDecodedProgramAccounts } from "./utils";

type PositionFilter = GetProgramAccountsMemcmpFilter & {
  readonly __kind: unique symbol;
};

export function positionFusionPoolFilter(address: Address): PositionFilter {
  return {
    memcmp: {
      offset: 10n,
      bytes: getBase58Decoder().decode(getAddressEncoder().encode(address)),
      encoding: "base58",
    },
  } as PositionFilter;
}

export function positionMintFilter(address: Address): PositionFilter {
  return {
    memcmp: {
      offset: 42n,
      bytes: getBase58Decoder().decode(getAddressEncoder().encode(address)),
      encoding: "base58",
    },
  } as PositionFilter;
}

export function positionTickLowerIndexFilter(tickLowerIndex: number): PositionFilter {
  return {
    memcmp: {
      offset: 90n,
      bytes: getBase58Decoder().decode(getI32Encoder().encode(tickLowerIndex)),
      encoding: "base58",
    },
  } as PositionFilter;
}

export function positionTickUpperIndexFilter(tickUpperIndex: number): PositionFilter {
  return {
    memcmp: {
      offset: 94n,
      bytes: getBase58Decoder().decode(getI32Encoder().encode(tickUpperIndex)),
      encoding: "base58",
    },
  } as PositionFilter;
}

export async function fetchAllPositionWithFilter(
  rpc: Rpc<GetProgramAccountsApi>,
  ...filters: PositionFilter[]
): Promise<Account<Position>[]> {
  const discriminator = getBase58Decoder().decode(POSITION_DISCRIMINATOR);
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
    getPositionDecoder(),
  );
}
