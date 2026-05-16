//
// Copyright (c) Cryptic Dot
//
// Modification based on Orca Whirlpools (https://github.com/orca-so/whirlpools),
// originally licensed under the Apache License, Version 2.0, prior to February 26, 2025.
//
// Modifications licensed under FusionAMM SDK Source-Available License v1.0
// See the LICENSE file in the project root for license information.
//

import type { GetAccountInfoApi, Rpc } from "@solana/kit";

import { fetchFusionPoolsConfig } from "../generated";
import { getFusionPoolsConfigAddress } from "../pda";

export async function fetchDefaultFusionPoolsConfig(rpc: Rpc<GetAccountInfoApi>) {
  const configAddress = await getFusionPoolsConfigAddress();
  await fetchFusionPoolsConfig(rpc, configAddress[0]);
}
