//
// Copyright (c) Cryptic Dot
//
// Modification based on Orca Whirlpools (https://github.com/orca-so/whirlpools),
// originally licensed under the Apache License, Version 2.0, prior to February 26, 2025.
//
// Modifications licensed under FusionAMM SDK Source-Available License v1.0
// See the LICENSE file in the project root for license information.
//

import type { Position, PositionBundle } from "@crypticdot/fusionamm-client";
import {
  fetchAllMaybePosition,
  fetchAllMaybePositionBundle,
  fetchAllPosition,
  fetchAllPositionWithFilter,
  getBundledPositionAddress,
  getPositionAddress,
  getPositionBundleAddress,
  positionFusionPoolFilter,
} from "@crypticdot/fusionamm-client";
import { _POSITION_BUNDLE_SIZE } from "@crypticdot/fusionamm-core";
import type {
  Account,
  Address,
  GetMultipleAccountsApi,
  GetProgramAccountsApi,
  GetTokenAccountsByOwnerApi,
  Rpc,
} from "@solana/kit";
import { getBase64Encoder } from "@solana/kit";
import { getTokenDecoder, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";

/**
 * Represents a Position account.
 */
export type HydratedPosition = Account<Position> & {
  isPositionBundle: false;
};

/**
 * Represents a Position Bundle account including its associated positions.
 */
export type HydratedPositionBundle = Account<PositionBundle> & {
  positions: Account<Position>[];
  isPositionBundle: true;
};

/**
 * Represents either a Position or Position Bundle account.
 */
export type PositionOrBundle = HydratedPosition | HydratedPositionBundle;

/**
 * Represents a decoded Position or Position Bundle account.
 * Includes the token program address associated with the position.
 */
export type PositionData = PositionOrBundle & {
  /** The token program associated with the position (either TOKEN_PROGRAM_ADDRESS or TOKEN_2022_PROGRAM_ADDRESS). */
  tokenProgram: Address;
};

function getPositionInBundleAddresses(positionBundle: PositionBundle): Promise<Address>[] {
  const buffer = Buffer.from(positionBundle.positionBitmap);
  const positions: Promise<Address>[] = [];
  for (let i = 0; i < _POSITION_BUNDLE_SIZE(); i++) {
    const byteIndex = Math.floor(i / 8);
    const bitIndex = i % 8;
    if (buffer[byteIndex] & (1 << bitIndex)) {
      positions.push(getBundledPositionAddress(positionBundle.positionBundleMint, i).then(x => x[0]));
    }
  }
  return positions;
}

/**
 * Fetches all positions owned by a given wallet in Fusion pool.
 * It looks for token accounts owned by the wallet using both the TOKEN_PROGRAM_ADDRESS and TOKEN_2022_PROGRAM_ADDRESS.
 * For token accounts holding exactly 1 token (indicating a position or bundle), it fetches the corresponding position addresses,
 * decodes the accounts, and returns an array of position or bundle data.
 *
 * @param {SolanaRpc} rpc - The Solana RPC client used to fetch token accounts and multiple accounts.
 * @param {Address} owner - The wallet address whose positions you want to fetch.
 * @returns {Promise<PositionData[]>} - A promise that resolves to an array of decoded position data for the given owner.
 *
 * @example
 * import { fetchPositionsForOwner } from '@crypticdot/fusionamm';
 * import { generateKeyPairSigner, createSolanaRpc, devnet } from '@solana/kit';
 *
 * const devnetRpc = createSolanaRpc(devnet('https://api.devnet.solana.com'));
 * const wallet = address("INSERT_WALLET_ADDRESS");
 *
 * const positions = await fetchPositionsForOwner(devnetRpc, wallet.address);
 */
export async function fetchPositionsForOwner(
  rpc: Rpc<GetTokenAccountsByOwnerApi & GetMultipleAccountsApi>,
  owner: Address,
): Promise<PositionData[]> {
  const [tokenAccounts, token2022Accounts] = await Promise.all([
    rpc.getTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ADDRESS }, { encoding: "base64" }).send(),
    rpc.getTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ADDRESS }, { encoding: "base64" }).send(),
  ]);

  const encoder = getBase64Encoder();
  const decoder = getTokenDecoder();

  const potentialTokens = [...tokenAccounts.value, ...token2022Accounts.value]
    .map(x => ({
      ...decoder.decode(encoder.encode(x.account.data[0])),
      tokenProgram: x.account.owner,
    }))
    .filter(x => x.amount === 1n);

  const positionAddresses = await Promise.all(potentialTokens.map(x => getPositionAddress(x.mint).then(x => x[0])));

  const positionBundleAddresses = await Promise.all(
    potentialTokens.map(x => getPositionBundleAddress(x.mint).then(x => x[0])),
  );

  // FIXME: need to batch if more than 100 position bundles?
  const [positions, positionBundles] = await Promise.all([
    fetchAllMaybePosition(rpc, positionAddresses),
    fetchAllMaybePositionBundle(rpc, positionBundleAddresses),
  ]);

  const bundledPositionAddresses = await Promise.all(
    positionBundles.filter(x => x.exists).flatMap(x => getPositionInBundleAddresses(x.data)),
  );

  const bundledPositions = await fetchAllPosition(rpc, bundledPositionAddresses);
  const bundledPositionMap = bundledPositions.reduce((acc, x) => {
    const current = acc.get(x.data.positionMint) ?? [];
    return acc.set(x.data.positionMint, [...current, x]);
  }, new Map<Address, Account<Position>[]>());

  const positionsOrBundles: PositionData[] = [];

  for (let i = 0; i < potentialTokens.length; i++) {
    const position = positions[i];
    const positionBundle = positionBundles[i];
    const token = potentialTokens[i];

    if (position.exists) {
      positionsOrBundles.push({
        ...position,
        tokenProgram: token.tokenProgram,
        isPositionBundle: false,
      });
    }

    if (positionBundle.exists) {
      const positions = bundledPositionMap.get(positionBundle.data.positionBundleMint) ?? [];
      positionsOrBundles.push({
        ...positionBundle,
        positions,
        tokenProgram: token.tokenProgram,
        isPositionBundle: true,
      });
    }
  }

  return positionsOrBundles;
}

/**
 * Fetches all positions for a given FusionPool.
 *
 * @param {SolanaRpc} rpc - The Solana RPC client used to fetch positions.
 * @param {Address} fusionPool - The address of the FusionPool.
 * @returns {Promise<HydratedPosition[]>} - A promise that resolves to an array of hydrated positions.
 *
 * @example
 * import { fetchPositionsInFusionPool } from '@crypticdot/fusionamm';
 * import { createSolanaRpc, devnet, address } from '@solana/kit';
 *
 * const devnetRpc = createSolanaRpc(devnet('https://api.devnet.solana.com'));
 *
 * const fusionPool = address("Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE");
 * const positions = await fetchPositionsInFusionPool(devnetRpc, fusionPool);
 */
export async function fetchPositionsInFusionPool(
  rpc: Rpc<GetProgramAccountsApi>,
  fusionPool: Address,
): Promise<HydratedPosition[]> {
  const positions = await fetchAllPositionWithFilter(rpc, positionFusionPoolFilter(fusionPool));
  return positions.map(x => ({
    ...x,
    isPositionBundle: false,
  }));
}
