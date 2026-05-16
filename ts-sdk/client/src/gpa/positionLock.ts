import type { Account, Address, GetProgramAccountsApi, GetProgramAccountsMemcmpFilter, Rpc } from "@solana/kit";
import { getAddressEncoder, getBase58Decoder } from "@solana/kit";

import {
  FUSIONAMM_PROGRAM_ADDRESS,
  getPositionLockDecoder,
  POSITION_LOCK_DISCRIMINATOR,
  PositionLock,
} from "../generated";

import { fetchDecodedProgramAccounts } from "./utils";

type PositionLockFilter = GetProgramAccountsMemcmpFilter & {
  readonly __kind: unique symbol;
};

export function positionLockPositionFilter(address: Address): PositionLockFilter {
  return {
    memcmp: {
      offset: 8n,
      bytes: getBase58Decoder().decode(getAddressEncoder().encode(address)),
      encoding: "base58",
    },
  } as PositionLockFilter;
}

export function positionLockPositionOwnerFilter(address: Address): PositionLockFilter {
  return {
    memcmp: {
      offset: 40n,
      bytes: getBase58Decoder().decode(getAddressEncoder().encode(address)),
      encoding: "base58",
    },
  } as PositionLockFilter;
}

export function positionLockFusionPoolFilter(address: Address): PositionLockFilter {
  return {
    memcmp: {
      offset: 72n,
      bytes: getBase58Decoder().decode(getAddressEncoder().encode(address)),
      encoding: "base58",
    },
  } as PositionLockFilter;
}

export async function fetchAllPositionLockWithFilter(
  rpc: Rpc<GetProgramAccountsApi>,
  ...filters: PositionLockFilter[]
): Promise<Account<PositionLock>[]> {
  const discriminator = getBase58Decoder().decode(POSITION_LOCK_DISCRIMINATOR);
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
    getPositionLockDecoder(),
  );
}
