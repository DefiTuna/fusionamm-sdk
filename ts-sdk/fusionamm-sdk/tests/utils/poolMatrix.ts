//
// Copyright (c) Cryptic Dot
//
// Modification based on Orca Whirlpools (https://github.com/orca-so/whirlpools),
// originally licensed under the Apache License, Version 2.0, prior to February 26, 2025.
//
// Modifications licensed under FusionAMM SDK Source-Available License v1.0
// See the LICENSE file in the project root for license information.
//

import { setupFusionPool } from "./program";
import { setupAta, setupMint } from "./token";
import { setupAtaTE, setupMintTE, setupMintTEFee } from "./tokenExtensions";

export const mintTypes = new Map([
  ["A", setupMint],
  ["B", setupMint],
  ["TEA", setupMintTE],
  ["TEB", setupMintTE],
  ["TEFeeA", setupMintTEFee],
  ["TEFeeB", setupMintTEFee],
]);

export const ataTypes = new Map([
  ["A", setupAta],
  ["B", setupAta],
  ["TEA", setupAtaTE],
  ["TEB", setupAtaTE],
  ["TEFeeA", setupAtaTE],
  ["TEFeeB", setupAtaTE],
]);

export const poolTypes = new Map([
  ["A-B", setupFusionPool],
  ["A-TEA", setupFusionPool],
  ["A-TEFeeA", setupFusionPool],
  ["TEA-TEB", setupFusionPool],
  ["TEA-TEFeeA", setupFusionPool],
  ["TEFeeA-TEFeeB", setupFusionPool],
]);
