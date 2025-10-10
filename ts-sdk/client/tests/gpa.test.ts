//
// Copyright (c) Cryptic Dot
//
// Modification based on Orca Whirlpools (https://github.com/orca-so/whirlpools),
// originally licensed under the Apache License, Version 2.0, prior to February 26, 2025.
//
// Modifications licensed under FusionAMM SDK Source-Available License v1.0
// See the LICENSE file in the project root for license information.
//

import { describe, it, beforeEach, afterEach, vi } from "vitest";
import assert from "assert";
import type { Address, GetProgramAccountsMemcmpFilter, ReadonlyUint8Array } from "@solana/kit";
import {
  createDefaultRpcTransport,
  createSolanaRpcFromTransport,
  getAddressDecoder,
  getBase58Encoder,
} from "@solana/kit";
import type {
  PositionArgs,
  PositionBundleArgs,
  FusionPoolArgs,
  TokenBadgeArgs,
  TickArrayArgs,
  TickArgs,
  LimitOrderArgs,
} from "../src";
import {
  getPositionEncoder,
  fetchAllPositionWithFilter,
  positionMintFilter,
  positionTickLowerIndexFilter,
  positionTickUpperIndexFilter,
  positionFusionPoolFilter,
  getPositionBundleEncoder,
  fetchAllPositionBundleWithFilter,
  positionBundleMintFilter,
  getTickArrayEncoder,
  fetchAllTickArrayWithFilter,
  tickArrayStartTickIndexFilter,
  tickArrayFusionPoolFilter,
  getTokenBadgeEncoder,
  fetchAllTokenBadgeWithFilter,
  tokenBadgeTokenMintFilter,
  getFusionPoolEncoder,
  fetchAllFusionPoolWithFilter,
  fusionPoolFeeRateFilter,
  fusionPoolProtocolFeeRateFilter,
  fusionPoolTickSpacingFilter,
  fusionPoolTokenMintAFilter,
  fusionPoolTokenMintBFilter,
  fusionPoolTokenVaultAFilter,
  fusionPoolTokenVaultBFilter,
  fetchAllLimitOrderWithFilter,
  getLimitOrderEncoder,
  limitOrderFusionPoolFilter,
  limitOrderMintFilter,
} from "../src";
import { fetchDecodedProgramAccounts } from "../src/gpa/utils";

describe("get program account memcmp filters", () => {
  const mockRpc = createSolanaRpcFromTransport(createDefaultRpcTransport({ url: "" }));
  const addresses: Address[] = [...Array(25).keys()].map(i => {
    const bytes = Array.from({ length: 32 }, () => i);
    return getAddressDecoder().decode(new Uint8Array(bytes));
  });

  beforeEach(() => {
    vi.mock("../src/gpa/utils", () => ({
      fetchDecodedProgramAccounts: vi.fn().mockResolvedValue([]),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function assertFilters(data: ReadonlyUint8Array) {
    const mockFetch = vi.mocked(fetchDecodedProgramAccounts);
    const filters = mockFetch.mock.calls[0][2] as GetProgramAccountsMemcmpFilter[];
    for (const filter of filters) {
      const offset = Number(filter.memcmp.offset);
      const actual = getBase58Encoder().encode(filter.memcmp.bytes);
      const expected = data.subarray(offset, offset + actual.length);
      assert.deepStrictEqual(actual, expected);
    }
  }

  it("Position", async () => {
    const positionStruct: PositionArgs = {
      version: 1,
      fusionPool: addresses[0],
      positionMint: addresses[1],
      liquidity: 1234,
      tickLowerIndex: 5678,
      tickUpperIndex: 9012,
      feeGrowthCheckpointA: 3456,
      feeOwedA: 7890,
      feeGrowthCheckpointB: 2345,
      feeOwedB: 6789,
      reserved: new Uint8Array(),
    };
    await fetchAllPositionWithFilter(
      mockRpc,
      positionFusionPoolFilter(positionStruct.fusionPool),
      positionMintFilter(positionStruct.positionMint),
      positionTickLowerIndexFilter(positionStruct.tickLowerIndex),
      positionTickUpperIndexFilter(positionStruct.tickUpperIndex),
    );
    const data = getPositionEncoder().encode(positionStruct);
    assertFilters(data);
  });

  it("Limit order", async () => {
    const limitOrderStruct: LimitOrderArgs = {
      version: 1,
      fusionPool: addresses[0],
      limitOrderMint: addresses[1],
      tickIndex: 344,
      aToB: false,
      age: 5,
      amount: 105400n,
      reserved: new Uint8Array(),
    };
    await fetchAllLimitOrderWithFilter(
      mockRpc,
      limitOrderFusionPoolFilter(limitOrderStruct.fusionPool),
      limitOrderMintFilter(limitOrderStruct.limitOrderMint),
    );
    const data = getLimitOrderEncoder().encode(limitOrderStruct);
    assertFilters(data);
  });

  it("PositionBundle", async () => {
    const positionBundleStruct: PositionBundleArgs = {
      positionBundleMint: addresses[0],
      positionBitmap: new Uint8Array(88),
    };
    await fetchAllPositionBundleWithFilter(mockRpc, positionBundleMintFilter(positionBundleStruct.positionBundleMint));
    const data = getPositionBundleEncoder().encode(positionBundleStruct);
    assertFilters(data);
  });

  it("TickArray", async () => {
    const tickStruct: TickArgs = {
      initialized: true,
      liquidityNet: 1234,
      liquidityGross: 5678,
      feeGrowthOutsideA: 9012,
      feeGrowthOutsideB: 3456,
      age: 777,
      openOrdersInput: 3242,
      partFilledOrdersInput: 6432354,
      partFilledOrdersRemainingInput: 783434,
      fulfilledAToBOrdersInput: 23463,
      fulfilledBToAOrdersInput: 14633,
    };
    const tickArrayStruct: TickArrayArgs = {
      startTickIndex: 1234,
      ticks: Array(88).fill(tickStruct),
      fusionPool: addresses[0],
    };
    await fetchAllTickArrayWithFilter(
      mockRpc,
      tickArrayStartTickIndexFilter(tickArrayStruct.startTickIndex),
      tickArrayFusionPoolFilter(tickArrayStruct.fusionPool),
    );
    const data = getTickArrayEncoder().encode(tickArrayStruct);
    assertFilters(data);
  });

  it("TokenBadge", async () => {
    const tokenBadgeStruct: TokenBadgeArgs = {
      tokenMint: addresses[0],
      reserved: new Uint8Array(),
    };
    await fetchAllTokenBadgeWithFilter(mockRpc, tokenBadgeTokenMintFilter(tokenBadgeStruct.tokenMint));
    const data = getTokenBadgeEncoder().encode(tokenBadgeStruct);
    assertFilters(data);
  });

  it("FusionPool", async () => {
    const fusionPoolStruct: FusionPoolArgs = {
      bump: new Uint8Array([0]),
      version: 1,
      tokenMintA: addresses[0],
      tokenMintB: addresses[1],
      tokenVaultA: addresses[2],
      tokenVaultB: addresses[3],
      tickSpacing: 1234,
      tickSpacingSeed: new Uint8Array([1, 2]),
      feeRate: 4321,
      protocolFeeRate: 5678,
      unused0: 0,
      liquidity: 9012,
      sqrtPrice: 3456,
      tickCurrentIndex: 7890,
      protocolFeeOwedA: 2345,
      protocolFeeOwedB: 6789,
      feeGrowthGlobalA: 9876,
      feeGrowthGlobalB: 5432,
      ordersTotalAmountA: 0,
      ordersTotalAmountB: 0,
      ordersFilledAmountA: 0,
      ordersFilledAmountB: 0,
      olpFeeOwedA: 0,
      olpFeeOwedB: 0,
      maSqrtPrice: 345624531235n,
      lastSwapTimestamp: 2323123,
      reserved: new Uint8Array(),
    };
    await fetchAllFusionPoolWithFilter(
      mockRpc,
      fusionPoolTokenMintAFilter(fusionPoolStruct.tokenMintA),
      fusionPoolTokenMintBFilter(fusionPoolStruct.tokenMintB),
      fusionPoolTokenVaultAFilter(fusionPoolStruct.tokenVaultA),
      fusionPoolTokenVaultBFilter(fusionPoolStruct.tokenVaultB),
      fusionPoolTickSpacingFilter(fusionPoolStruct.tickSpacing),
      fusionPoolFeeRateFilter(fusionPoolStruct.feeRate),
      fusionPoolProtocolFeeRateFilter(fusionPoolStruct.protocolFeeRate),
    );
    const data = getFusionPoolEncoder().encode(fusionPoolStruct);
    assertFilters(data);
  });
});
