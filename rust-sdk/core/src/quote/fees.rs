//
// Copyright (c) Cryptic Dot
//
// Modification based on Orca Whirlpools (https://github.com/orca-so/whirlpools),
// originally licensed under the Apache License, Version 2.0, prior to February 26, 2025.
//
// Modifications licensed under FusionAMM SDK Source-Available License v1.0
// See the LICENSE file in the project root for license information.
//
use ethnum::U256;

#[cfg(feature = "wasm")]
use fusionamm_macros::wasm_expose;

use crate::{
    try_apply_transfer_fee, CollectFeesQuote, CoreError, FusionPoolFacade, PositionFacade, TickFacade, TransferFee, AMOUNT_EXCEEDS_MAX_U64,
    ARITHMETIC_OVERFLOW, MAX_CLP_REWARD_RATE, MAX_ORDER_PROTOCOL_FEE_RATE,
};

/// Calculate fees owed for a position
///
/// # Paramters
/// - `fusion_pool`: The fusion_pool state
/// - `position`: The position state
/// - `tick_lower`: The lower tick state
/// - `tick_upper`: The upper tick state
/// - `transfer_fee_a`: The transfer fee for token A
/// - `transfer_fee_b`: The transfer fee for token B
///
/// # Returns
/// - `CollectFeesQuote`: The fees owed for token A and token B
#[allow(clippy::too_many_arguments)]
#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn collect_fees_quote(
    fusion_pool: FusionPoolFacade,
    position: PositionFacade,
    tick_lower: TickFacade,
    tick_upper: TickFacade,
    transfer_fee_a: Option<TransferFee>,
    transfer_fee_b: Option<TransferFee>,
) -> Result<CollectFeesQuote, CoreError> {
    let mut fee_growth_below_a: u128 = tick_lower.fee_growth_outside_a;
    let mut fee_growth_above_a: u128 = tick_upper.fee_growth_outside_a;
    let mut fee_growth_below_b: u128 = tick_lower.fee_growth_outside_b;
    let mut fee_growth_above_b: u128 = tick_upper.fee_growth_outside_b;

    if fusion_pool.tick_current_index < position.tick_lower_index {
        fee_growth_below_a = fusion_pool.fee_growth_global_a.wrapping_sub(fee_growth_below_a);
        fee_growth_below_b = fusion_pool.fee_growth_global_b.wrapping_sub(fee_growth_below_b);
    }

    if fusion_pool.tick_current_index >= position.tick_upper_index {
        fee_growth_above_a = fusion_pool.fee_growth_global_a.wrapping_sub(fee_growth_above_a);
        fee_growth_above_b = fusion_pool.fee_growth_global_b.wrapping_sub(fee_growth_above_b);
    }

    let fee_growth_inside_a = fusion_pool
        .fee_growth_global_a
        .wrapping_sub(fee_growth_below_a)
        .wrapping_sub(fee_growth_above_a);

    let fee_growth_inside_b = fusion_pool
        .fee_growth_global_b
        .wrapping_sub(fee_growth_below_b)
        .wrapping_sub(fee_growth_above_b);

    let fee_growth_delta_a = fee_growth_inside_a.wrapping_sub(position.fee_growth_checkpoint_a);

    let fee_growth_delta_b = fee_growth_inside_b.wrapping_sub(position.fee_growth_checkpoint_b);

    let fee_owed_delta_a: U256 = <U256>::from(fee_growth_delta_a)
        .checked_mul(position.liquidity.into())
        .ok_or(ARITHMETIC_OVERFLOW)?
        >> 64;

    let fee_owed_delta_b: U256 = <U256>::from(fee_growth_delta_b)
        .checked_mul(position.liquidity.into())
        .ok_or(ARITHMETIC_OVERFLOW)?
        >> 64;

    let fee_owed_delta_a: u64 = fee_owed_delta_a.try_into().map_err(|_| AMOUNT_EXCEEDS_MAX_U64)?;
    let fee_owed_delta_b: u64 = fee_owed_delta_b.try_into().map_err(|_| AMOUNT_EXCEEDS_MAX_U64)?;

    let withdrawable_fee_a = position.fee_owed_a + fee_owed_delta_a;
    let withdrawable_fee_b = position.fee_owed_b + fee_owed_delta_b;

    let fee_owed_a = try_apply_transfer_fee(withdrawable_fee_a, transfer_fee_a.unwrap_or_default())?;
    let fee_owed_b = try_apply_transfer_fee(withdrawable_fee_b, transfer_fee_b.unwrap_or_default())?;

    Ok(CollectFeesQuote { fee_owed_a, fee_owed_b })
}

#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn limit_order_fee(fusion_pool: FusionPoolFacade) -> i32 {
    let fee = fusion_pool.fee_rate as u64 * (MAX_ORDER_PROTOCOL_FEE_RATE as u64 - fusion_pool.order_protocol_fee_rate as u64)
        / MAX_ORDER_PROTOCOL_FEE_RATE as u64
        * (MAX_CLP_REWARD_RATE as u64 - fusion_pool.clp_reward_rate as u64)
        / MAX_CLP_REWARD_RATE as u64;
    -(fee as i32)
}

#[cfg(all(test, not(feature = "wasm")))]
mod tests {
    use super::*;

    fn test_fusion_pool(tick_index: i32) -> FusionPoolFacade {
        FusionPoolFacade {
            tick_current_index: tick_index,
            fee_growth_global_a: 800,
            fee_growth_global_b: 1000,
            ..FusionPoolFacade::default()
        }
    }

    fn test_position() -> PositionFacade {
        PositionFacade {
            liquidity: 10000000000000000000,
            tick_lower_index: 5,
            tick_upper_index: 10,
            fee_growth_checkpoint_a: 0,
            fee_owed_a: 400,
            fee_growth_checkpoint_b: 0,
            fee_owed_b: 600,
            ..PositionFacade::default()
        }
    }

    fn test_tick() -> TickFacade {
        TickFacade {
            fee_growth_outside_a: 50,
            fee_growth_outside_b: 20,
            ..TickFacade::default()
        }
    }

    #[test]
    fn test_collect_out_of_range_lower() {
        let result = collect_fees_quote(test_fusion_pool(0), test_position(), test_tick(), test_tick(), None, None).unwrap();
        assert_eq!(result.fee_owed_a, 400);
        assert_eq!(result.fee_owed_b, 600);
    }

    #[test]
    fn test_in_range() {
        let result = collect_fees_quote(test_fusion_pool(7), test_position(), test_tick(), test_tick(), None, None).unwrap();
        assert_eq!(result.fee_owed_a, 779);
        assert_eq!(result.fee_owed_b, 1120);
    }

    #[test]
    fn test_collect_out_of_range_upper() {
        let result = collect_fees_quote(test_fusion_pool(15), test_position(), test_tick(), test_tick(), None, None).unwrap();
        assert_eq!(result.fee_owed_a, 400);
        assert_eq!(result.fee_owed_b, 600);
    }

    #[test]
    fn test_collect_on_range_lower() {
        let result = collect_fees_quote(test_fusion_pool(5), test_position(), test_tick(), test_tick(), None, None).unwrap();
        assert_eq!(result.fee_owed_a, 779);
        assert_eq!(result.fee_owed_b, 1120);
    }

    #[test]
    fn test_collect_on_upper() {
        let result = collect_fees_quote(test_fusion_pool(10), test_position(), test_tick(), test_tick(), None, None).unwrap();
        assert_eq!(result.fee_owed_a, 400);
        assert_eq!(result.fee_owed_b, 600);
    }

    #[test]
    fn test_collect_transfer_fee() {
        let result = collect_fees_quote(
            test_fusion_pool(7),
            test_position(),
            test_tick(),
            test_tick(),
            Some(TransferFee::new(2000)),
            Some(TransferFee::new(5000)),
        )
        .unwrap();
        assert_eq!(result.fee_owed_a, 623);
        assert_eq!(result.fee_owed_b, 560);
    }

    #[test]
    fn test_cyclic_growth_checkpoint() {
        let position = PositionFacade {
            liquidity: 91354442895,
            tick_lower_index: 15168,
            tick_upper_index: 19648,
            fee_growth_checkpoint_a: 340282366920938463463368367551765494643,
            fee_growth_checkpoint_b: 340282366920938463463235752370561182038,
            ..PositionFacade::default()
        };

        let fusion_pool = FusionPoolFacade {
            tick_current_index: 18158,
            fee_growth_global_a: 388775621815491196,
            fee_growth_global_b: 2114651338550574490,
            ..FusionPoolFacade::default()
        };

        let tick_lower = TickFacade {
            fee_growth_outside_a: 334295763697402279,
            fee_growth_outside_b: 1816428862338027402,
            ..TickFacade::default()
        };

        let tick_upper = TickFacade {
            fee_growth_outside_a: 48907059211668900,
            fee_growth_outside_b: 369439434559592375,
            ..TickFacade::default()
        };

        let result = collect_fees_quote(fusion_pool, position, tick_lower, tick_upper, None, None).unwrap();
        assert_eq!(result.fee_owed_a, 58500334);
        assert_eq!(result.fee_owed_b, 334966494);
    }

    #[test]
    fn test_limit_order_fee() {
        let result = limit_order_fee(FusionPoolFacade {
            fee_rate: 10000,
            order_protocol_fee_rate: MAX_ORDER_PROTOCOL_FEE_RATE / 2,
            clp_reward_rate: MAX_CLP_REWARD_RATE / 2,
            ..FusionPoolFacade::default()
        });
        assert_eq!(result, -2500);
    }
}
