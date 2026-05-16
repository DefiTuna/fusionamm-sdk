//
// Copyright (c) Cryptic Dot
//
// Modification based on Orca Whirlpools (https://github.com/orca-so/whirlpools),
// originally licensed under the Apache License, Version 2.0, prior to February 26, 2025.
//
// Modifications licensed under FusionAMM SDK Source-Available License v1.0
// See the LICENSE file in the project root for license information.
//

import type { Address, TransactionSigner } from "@solana/kit";
import { address, createNoopSigner } from "@solana/kit";

/**
 * The default (null) address.
 */
export const DEFAULT_ADDRESS = address("11111111111111111111111111111111");

/**
 * The default funder for transactions. No explicit funder specified.
 */
export const DEFAULT_FUNDER: TransactionSigner = createNoopSigner(DEFAULT_ADDRESS);

/**
 * The currently selected funder for transactions.
 */
export let FUNDER: TransactionSigner = DEFAULT_FUNDER;

/**
 * Sets the default funder for transactions.
 *
 * @param {TransactionSigner | Address | null} funder - The funder to be set as default, either as an address or a transaction signer.
 */
export function setDefaultFunder(funder: TransactionSigner | Address | null): void {
  if (typeof funder === "string") {
    FUNDER = createNoopSigner(funder);
  } else {
    FUNDER = funder ?? createNoopSigner(DEFAULT_ADDRESS);
  }
}

/**
 * The default slippage tolerance, expressed in basis points. Value of 100 is equivalent to 1%.
 */
export const DEFAULT_SLIPPAGE_TOLERANCE_BPS = 100;

/**
 * The currently selected slippage tolerance, expressed in basis points. Value of 100 is equivalent to 1%.
 */
export let SLIPPAGE_TOLERANCE_BPS = DEFAULT_SLIPPAGE_TOLERANCE_BPS;

/**
 * Sets the default slippage tolerance for transactions.
 *
 * @param {number} slippageToleranceBps - The slippage tolerance, expressed basis points. Value of 100 is equivalent to 1%.
 */
export function setDefaultSlippageToleranceBps(slippageToleranceBps: number): void {
  SLIPPAGE_TOLERANCE_BPS = Math.floor(slippageToleranceBps);
}

/**
 * Defines the strategy for handling Native Mint wrapping in a transaction.
 *
 * - **Keypair**:
 *   Creates an auxiliary token account using a keypair.
 *   Optionally adds funds to the account.
 *   Closes it at the end of the transaction.
 *
 * - **Seed**:
 *   Functions similarly to Keypair, but uses a seed account instead.
 *
 * - **ATA**:
 *   Treats the native balance and associated token account (ATA) for `NATIVE_MINT` as one.
 *   Will create the ATA if it doesn't exist.
 *   Optionally adds funds to the account.
 *   Closes it at the end of the transaction if it did not exist before.
 *
 * - **None**:
 *   Uses or creates the ATA without performing any Native Mint wrapping or unwrapping.
 */
export type NativeMintWrappingStrategy = "keypair" | "seed" | "ata" | "none";

/**
 * The default native mint wrapping strategy.
 */
export const DEFAULT_NATIVE_MINT_WRAPPING_STRATEGY: NativeMintWrappingStrategy = "keypair";

/**
 * The currently selected native mint wrapping strategy.
 */
export let NATIVE_MINT_WRAPPING_STRATEGY: NativeMintWrappingStrategy = DEFAULT_NATIVE_MINT_WRAPPING_STRATEGY;

/**
 * Sets the native mint wrapping strategy.
 *
 * @param {NativeMintWrappingStrategy} strategy - The native mint wrapping strategy.
 */
export function setNativeMintWrappingStrategy(strategy: NativeMintWrappingStrategy): void {
  NATIVE_MINT_WRAPPING_STRATEGY = strategy;
}

/**
 * Resets the configuration to its default state.
 *
 * @returns {Promise<void>} - Resolves when the configuration has been reset.
 */
export function resetConfiguration() {
  FUNDER = DEFAULT_FUNDER;
  SLIPPAGE_TOLERANCE_BPS = DEFAULT_SLIPPAGE_TOLERANCE_BPS;
  NATIVE_MINT_WRAPPING_STRATEGY = DEFAULT_NATIVE_MINT_WRAPPING_STRATEGY;
}
