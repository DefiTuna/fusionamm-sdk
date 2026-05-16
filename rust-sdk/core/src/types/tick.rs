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
use serde_big_array::BigArray;

use crate::TICK_ARRAY_SIZE;
#[cfg(feature = "wasm")]
use fusionamm_macros::wasm_expose;

#[derive(Copy, Clone, Debug, PartialEq, Eq, Default)]
#[cfg_attr(feature = "wasm", wasm_expose)]
pub struct TickRange {
    pub tick_lower_index: i32,
    pub tick_upper_index: i32,
}

#[derive(Copy, Clone, Debug, PartialEq, Eq, Default)]
#[cfg_attr(feature = "wasm", wasm_expose)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct TickFacade {
    pub initialized: bool,
    pub liquidity_net: i128,
    pub liquidity_gross: u128,
    pub fee_growth_outside_a: u128,
    pub fee_growth_outside_b: u128,
    pub age: u64,
    pub open_orders_input: u64,
    pub part_filled_orders_input: u64,
    pub part_filled_orders_remaining_input: u64,
    pub fulfilled_a_to_b_orders_input: u64,
    pub fulfilled_b_to_a_orders_input: u64,
}

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "wasm", wasm_expose)]
pub struct TickArrayFacade {
    pub start_tick_index: i32,
    #[cfg_attr(feature = "wasm", serde(with = "BigArray"))]
    pub ticks: [TickFacade; TICK_ARRAY_SIZE],
}
