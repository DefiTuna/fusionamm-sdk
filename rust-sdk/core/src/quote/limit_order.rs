//
// Copyright (c) Cryptic Dot
//
// Licensed under FusionAMM SDK Source-Available License v1.0
// See the LICENSE file in the project root for license information.
//

use crate::math::get_limit_order_output_amount;
use crate::{
    tick_index_to_sqrt_price, try_apply_transfer_fee, try_mul_div, try_reverse_apply_swap_fee, CoreError, FusionPoolFacade, LimitOrderDecreaseQuote,
    LimitOrderFacade, TickFacade, TransferFee, AMOUNT_EXCEEDS_LIMIT_ORDER_INPUT_AMOUNT, AMOUNT_EXCEEDS_MAX_U64, FEE_RATE_MUL_VALUE,
    LIMIT_ORDER_AND_POOL_ARE_OUT_OF_SYNC, PROTOCOL_FEE_RATE_MUL_VALUE,
};

#[cfg(feature = "wasm")]
use fusionamm_macros::wasm_expose;

/// Computes the limit order output amount by input amount.
/// ### Parameters
/// - `amount_in` - The input token amount of a limit order.
/// - `a_to_b_order` - The limit order direction.
/// - `tick_index` - The tick index of an order.
/// - `fusion_pool` - The fusion_pool state.
#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn limit_order_quote_by_input_token(
    amount_in: u64,
    a_to_b_order: bool,
    tick_index: i32,
    fusion_pool: FusionPoolFacade,
) -> Result<u64, CoreError> {
    let sqrt_price: u128 = tick_index_to_sqrt_price(tick_index).into();
    let mut amount_out = get_limit_order_output_amount(amount_in, a_to_b_order, sqrt_price, false)?;
    amount_out += limit_order_reward_by_output_token(amount_out, fusion_pool.fee_rate, fusion_pool.protocol_fee_rate)?;
    Ok(amount_out)
}

/// Computes the limit order input amount by output amount.
/// ### Parameters
/// - `amount_out` - The output token amount of a limit order.
/// - `a_to_b_order` - The limit order direction.
/// - `tick_index` - The tick index of an order.
/// - `fusion_pool` - The fusion_pool state.
#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn limit_order_quote_by_output_token(
    amount_out: u64,
    a_to_b_order: bool,
    tick_index: i32,
    fusion_pool: FusionPoolFacade,
) -> Result<u64, CoreError> {
    let sqrt_price: u128 = tick_index_to_sqrt_price(tick_index).into();

    let f = fusion_pool.fee_rate as f64 / FEE_RATE_MUL_VALUE as f64;
    let p = fusion_pool.protocol_fee_rate as f64 / PROTOCOL_FEE_RATE_MUL_VALUE as f64;

    // Output amount without reward = O
    // Limit order reward = R = swap_fee⋅(1-p) = O⋅f/(1-f)⋅(1-p)
    // Output amount with fees = O' = O + R = O ⋅ (1 + f/(1-f)⋅(1-p))
    let denominator = 1.0 + (f / (1.0 - f) * (1.0 - p));
    let amount_out_with_fees = amount_out as f64 / denominator;

    if amount_out_with_fees < 0.0 || amount_out_with_fees > u64::MAX as f64 {
        return Err(AMOUNT_EXCEEDS_MAX_U64);
    }

    let amount_in = get_limit_order_output_amount(amount_out_with_fees as u64, !a_to_b_order, sqrt_price, true)?;

    Ok(amount_in)
}

/// Computes the limit order reward by input amount.
/// ### Parameters
/// - `amount_out` - The output token amount of a limit order (swap input).
/// - `a_to_b_order` - The limit order direction.
/// - `tick_index` - The tick index of an order.
/// - `fusion_pool` - The fusion_pool state.
#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn limit_order_reward_by_output_token(amount_out: u64, fee_rate: u16, protocol_fee_rate: u16) -> Result<u64, CoreError> {
    // Reward = swap_fee⋅(1 - protocol_fee_rate)
    let swap_fee = try_reverse_apply_swap_fee(amount_out.into(), fee_rate)? - amount_out;
    // Deduct the protocol fee from the total swap fee.
    let reward = swap_fee - try_mul_div(swap_fee, protocol_fee_rate as u128, PROTOCOL_FEE_RATE_MUL_VALUE as u128, false)?;
    Ok(reward)
}

#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn decrease_limit_order_quote(
    fusion_pool: FusionPoolFacade,
    limit_order: LimitOrderFacade,
    tick: TickFacade,
    amount: u64,
    transfer_fee_a: Option<TransferFee>,
    transfer_fee_b: Option<TransferFee>,
) -> Result<LimitOrderDecreaseQuote, CoreError> {
    if amount > limit_order.amount {
        return Err(AMOUNT_EXCEEDS_LIMIT_ORDER_INPUT_AMOUNT);
    }

    // Not filled
    let (amount_in, amount_out) = if limit_order.age == tick.age {
        (amount, 0)
    }
    // Partially filled
    else if limit_order.age + 1 == tick.age {
        if tick.part_filled_orders_input == 0 {
            return Err(LIMIT_ORDER_AND_POOL_ARE_OUT_OF_SYNC);
        }
        let sqrt_price: u128 = tick_index_to_sqrt_price(limit_order.tick_index).into();
        let remaining_input = try_mul_div(amount, tick.part_filled_orders_remaining_input as u128, tick.part_filled_orders_input as u128, false)?;
        let amount_out = get_limit_order_output_amount(amount - remaining_input, limit_order.a_to_b, sqrt_price, false)?;
        (remaining_input, amount_out)
    }
    // Fulfilled
    else if limit_order.age + 2 <= tick.age {
        let sqrt_price: u128 = tick_index_to_sqrt_price(limit_order.tick_index).into();
        let amount_out = get_limit_order_output_amount(amount, limit_order.a_to_b, sqrt_price, false)?;
        (0, amount_out)
    } else {
        return Err(LIMIT_ORDER_AND_POOL_ARE_OUT_OF_SYNC);
    };

    let mut amount_out_a;
    let mut amount_out_b;
    let mut reward_a = 0;
    let mut reward_b = 0;

    if limit_order.a_to_b {
        let filled_amount = amount - amount_in;
        // Fees and rewards are paid in the output token B of a limit order. The reward amount is based on the portion of the order that is filled.
        if filled_amount > 0 {
            if fusion_pool.orders_filled_amount_a == 0 {
                return Err(LIMIT_ORDER_AND_POOL_ARE_OUT_OF_SYNC);
            }
            reward_b = try_mul_div(fusion_pool.olp_fee_owed_b, filled_amount as u128, fusion_pool.orders_filled_amount_a as u128, false)?;
        }
        // How much of tokens A and B transfer to the owner.
        amount_out_a = amount_in;
        amount_out_b = amount_out + reward_b;
    } else {
        let filled_amount = amount - amount_in;
        // Fees and rewards are paid in the output token A of a limit order. The reward amount is based on the portion of the order that is filled.
        if filled_amount > 0 {
            if fusion_pool.orders_filled_amount_b == 0 {
                return Err(LIMIT_ORDER_AND_POOL_ARE_OUT_OF_SYNC);
            }
            reward_a = try_mul_div(fusion_pool.olp_fee_owed_a, filled_amount as u128, fusion_pool.orders_filled_amount_b as u128, false)?;
        }
        // How much of tokens A and B transfer to the owner.
        amount_out_a = amount_out + reward_a;
        amount_out_b = amount_in;
    }

    amount_out_a = try_apply_transfer_fee(amount_out_a, transfer_fee_a.unwrap_or_default())?;
    amount_out_b = try_apply_transfer_fee(amount_out_b, transfer_fee_b.unwrap_or_default())?;

    Ok(LimitOrderDecreaseQuote {
        amount_out_a,
        amount_out_b,
        reward_a,
        reward_b,
    })
}

#[cfg(all(test, not(feature = "wasm")))]
mod tests {
    use crate::{
        decrease_limit_order_quote, limit_order_quote_by_input_token, limit_order_quote_by_output_token, price_to_tick_index,
        sqrt_price_to_tick_index, FusionPoolFacade, LimitOrderFacade, TickFacade,
    };
    const TEN_PCT: u16 = 1000;
    const ONE_PCT_FEE_RATE: u16 = 10000;

    fn test_fusion_pool(sqrt_price: u128, fee_rate: u16, protocol_fee_rate: u16) -> FusionPoolFacade {
        let tick_current_index = sqrt_price_to_tick_index(sqrt_price);
        FusionPoolFacade {
            tick_current_index,
            fee_rate,
            protocol_fee_rate,
            sqrt_price,
            tick_spacing: 2,
            ..FusionPoolFacade::default()
        }
    }

    #[test]
    // Equal to a similar test in limit_order_manager::calculate_modify_limit_order_unit_tests of the FusionAMM program.
    fn partially_decrease_not_filled_a_to_b_order() {
        let quote = decrease_limit_order_quote(
            FusionPoolFacade {
                ..FusionPoolFacade::default()
            },
            LimitOrderFacade {
                tick_index: 128,
                amount: 50_000,
                a_to_b: true,
                age: 5,
            },
            TickFacade {
                age: 5,
                open_orders_input: 100_000,
                part_filled_orders_input: 0,
                part_filled_orders_remaining_input: 0,
                fulfilled_a_to_b_orders_input: 0,
                fulfilled_b_to_a_orders_input: 0,
                ..TickFacade::default()
            },
            25_000,
            None,
            None,
        )
        .unwrap();

        assert_eq!(quote.amount_out_a, 25_000);
        assert_eq!(quote.amount_out_b, 0);
    }

    #[test]
    // Equal to a similar test in limit_order_manager::calculate_modify_limit_order_unit_tests of the FusionAMM program.
    fn partially_decrease_semi_filled_a_to_b_order() {
        let quote = decrease_limit_order_quote(
            FusionPoolFacade {
                protocol_fee_rate: TEN_PCT,
                orders_filled_amount_a: 80_000,
                olp_fee_owed_b: 500,
                ..FusionPoolFacade::default()
            },
            LimitOrderFacade {
                tick_index: 128,
                amount: 50_000,
                a_to_b: true,
                age: 5,
            },
            TickFacade {
                age: 6,
                open_orders_input: 0,
                part_filled_orders_input: 200_000,
                part_filled_orders_remaining_input: 120_000,
                fulfilled_a_to_b_orders_input: 0,
                fulfilled_b_to_a_orders_input: 0,
                ..TickFacade::default()
            },
            25_000,
            None,
            None,
        )
        .unwrap();

        assert_eq!(quote.amount_out_a, 15000);
        assert_eq!(quote.amount_out_b, 10190);
        assert_eq!(quote.reward_a, 0);
        assert_eq!(quote.reward_b, 62);
    }

    #[test]
    // Equal to a similar test in limit_order_manager::calculate_modify_limit_order_unit_tests of the FusionAMM program.
    fn partially_decrease_semi_filled_b_to_a_order() {
        let quote = decrease_limit_order_quote(
            FusionPoolFacade {
                protocol_fee_rate: TEN_PCT,
                orders_filled_amount_b: 80_000,
                olp_fee_owed_a: 500,
                ..FusionPoolFacade::default()
            },
            LimitOrderFacade {
                tick_index: 128,
                amount: 50_000,
                a_to_b: false,
                age: 5,
            },
            TickFacade {
                age: 6,
                open_orders_input: 0,
                part_filled_orders_input: 200_000,
                part_filled_orders_remaining_input: 120_000,
                fulfilled_a_to_b_orders_input: 0,
                fulfilled_b_to_a_orders_input: 0,
                ..TickFacade::default()
            },
            25_000,
            None,
            None,
        )
        .unwrap();

        assert_eq!(quote.amount_out_a, 9934);
        assert_eq!(quote.amount_out_b, 15000);
        assert_eq!(quote.reward_a, 62);
        assert_eq!(quote.reward_b, 0);
    }

    #[test]
    // Equal to a similar test in limit_order_manager::calculate_modify_limit_order_unit_tests of the FusionAMM program.
    fn partially_decrease_fulfilled_a_to_b() {
        let quote = decrease_limit_order_quote(
            FusionPoolFacade {
                protocol_fee_rate: TEN_PCT,
                orders_filled_amount_a: 100_000,
                olp_fee_owed_b: 500,
                ..FusionPoolFacade::default()
            },
            LimitOrderFacade {
                tick_index: 128,
                amount: 100_000,
                a_to_b: true,
                age: 5,
            },
            TickFacade {
                age: 7,
                open_orders_input: 0,
                part_filled_orders_input: 0,
                part_filled_orders_remaining_input: 0,
                fulfilled_a_to_b_orders_input: 100_000,
                fulfilled_b_to_a_orders_input: 80_000,
                ..TickFacade::default()
            },
            10_000,
            None,
            None,
        )
        .unwrap();

        assert_eq!(quote.amount_out_a, 0);
        assert_eq!(quote.amount_out_b, 10178);
        assert_eq!(quote.reward_a, 0);
        assert_eq!(quote.reward_b, 50);
    }

    #[test]
    // Equal to a similar test in limit_order_manager::calculate_modify_limit_order_unit_tests of the FusionAMM program.
    fn partially_decrease_fulfilled_b_to_a() {
        let quote = decrease_limit_order_quote(
            FusionPoolFacade {
                protocol_fee_rate: TEN_PCT,
                orders_filled_amount_b: 80_000,
                olp_fee_owed_a: 500,
                ..FusionPoolFacade::default()
            },
            LimitOrderFacade {
                tick_index: 128,
                amount: 100_000,
                a_to_b: false,
                age: 5,
            },
            TickFacade {
                age: 7,
                open_orders_input: 0,
                part_filled_orders_input: 0,
                part_filled_orders_remaining_input: 0,
                fulfilled_a_to_b_orders_input: 100_000,
                fulfilled_b_to_a_orders_input: 80_000,
                ..TickFacade::default()
            },
            10_000,
            None,
            None,
        )
        .unwrap();

        assert_eq!(quote.amount_out_a, 9934);
        assert_eq!(quote.amount_out_b, 0);
        assert_eq!(quote.reward_a, 62);
        assert_eq!(quote.reward_b, 0);
    }

    #[test]
    fn test_limit_order_quote_by_input_token() {
        // zero swap fee
        assert_eq!(
            limit_order_quote_by_input_token(10_000, true, price_to_tick_index(2.0, 1, 1), test_fusion_pool(1 << 64, 0, 0)).unwrap(),
            19998
        );

        // 1% swap fee
        assert_eq!(
            limit_order_quote_by_input_token(10_000, true, price_to_tick_index(2.0, 1, 1), test_fusion_pool(1 << 64, ONE_PCT_FEE_RATE, 0)).unwrap(),
            20200
        );

        // 1% swap fee, protocol_fee = 10%
        assert_eq!(
            limit_order_quote_by_input_token(10_000, true, price_to_tick_index(2.0, 1, 1), test_fusion_pool(1 << 64, ONE_PCT_FEE_RATE, TEN_PCT))
                .unwrap(),
            20180
        );
    }

    #[test]
    fn test_limit_order_quote_by_output_token() {
        // zero swap fee
        assert_eq!(
            limit_order_quote_by_output_token(19998, true, price_to_tick_index(2.0, 1, 1), test_fusion_pool(1 << 64, 0, TEN_PCT)).unwrap(),
            10_000
        );

        // 1% swap fee
        assert_eq!(
            limit_order_quote_by_output_token(20200, true, price_to_tick_index(2.0, 1, 1), test_fusion_pool(1 << 64, ONE_PCT_FEE_RATE, 0)).unwrap(),
            10_000
        );

        // 1% swap fee, protocol_fee = 10%
        assert_eq!(
            limit_order_quote_by_output_token(20180, true, price_to_tick_index(2.0, 1, 1), test_fusion_pool(1 << 64, ONE_PCT_FEE_RATE, TEN_PCT))
                .unwrap(),
            10_000
        );
    }
}
