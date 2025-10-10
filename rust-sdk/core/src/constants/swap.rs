//
// Copyright (c) Cryptic Dot
//
// Modification based on Orca Whirlpools (https://github.com/orca-so/whirlpools),
// originally licensed under the Apache License, Version 2.0, prior to February 26, 2025.
//
// Modifications licensed under FusionAMM SDK Source-Available License v1.0
// See the LICENSE file in the project root for license information.
//

#![allow(non_snake_case)]

#[cfg(feature = "wasm")]
use fusionamm_macros::wasm_expose;

#[cfg_attr(feature = "wasm", wasm_expose)]
pub const FEE_RATE_MUL_VALUE: u32 = 1_000_000;

#[cfg_attr(feature = "wasm", wasm_expose)]
pub const MAX_PROTOCOL_FEE_RATE: u16 = 2_500;

#[cfg_attr(feature = "wasm", wasm_expose)]
pub const PROTOCOL_FEE_RATE_MUL_VALUE: u16 = 10_000;

// TODO: WASM export (which doesn't work with u128 yet)
pub const MIN_SQRT_PRICE: u128 = 4295048016;
pub const MAX_SQRT_PRICE: u128 = 79226673515401279992447579055;
