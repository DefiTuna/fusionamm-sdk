//
// Copyright (c) Cryptic Dot
//
// Modification based on Orca Whirlpools (https://github.com/orca-so/whirlpools),
// originally licensed under the Apache License, Version 2.0, prior to February 26, 2025.
//
// Modifications licensed under FusionAMM SDK Source-Available License v1.0
// See the LICENSE file in the project root for license information.
//

import type { KeyPairSigner } from "@solana/kit";
import { generateKeyPairSigner } from "@solana/kit";

import { orderMints } from "../../src/token";

const keypairs = await Promise.all(
  Array(100)
    .fill(0)
    .map(() => generateKeyPairSigner()),
);

const orderedKeypairs = [...keypairs].sort((a, b) => (orderMints(a.address, b.address)[0] === a.address ? -1 : 1));
let index = 0;

/**
 * Because for certain functions mint keypairs need to be ordered correctly
 * we made this function to get the next keypair in such a way that it
 * is always ordered behind the previous one
 */
export function getNextKeypair(): KeyPairSigner {
  return orderedKeypairs[index++];
}
