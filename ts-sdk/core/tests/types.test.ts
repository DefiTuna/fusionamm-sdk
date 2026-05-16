//
// Copyright (c) Cryptic Dot
//
// Modification based on Orca Whirlpools (https://github.com/orca-so/whirlpools),
// originally licensed under the Apache License, Version 2.0, prior to February 26, 2025.
//
// Modifications licensed under FusionAMM SDK Source-Available License v1.0
// See the LICENSE file in the project root for license information.
//

import { describe, it } from "vitest";

import type { FusionPool, Position } from "../../client/src";
import type { FusionPoolFacade, PositionFacade } from "../dist/nodejs/fusionamm_core_js_bindings";

// Since these tests are only for type checking, nothing actually happens at runtime.

describe("WASM exported types match Codama types", () => {
  it("FusionPool", () => {
    const fauxFusionPool = {} as FusionPool;
    fauxFusionPool satisfies FusionPoolFacade;
  });

  it("Position", () => {
    const fauxPosition = {} as Position;
    fauxPosition satisfies PositionFacade;
  });

  //  it("TickArray", () => {
  //    const fauxTickArray = {} as TickArray;
  //    fauxTickArray satisfies TickArrayFacade;
  //  });
});
