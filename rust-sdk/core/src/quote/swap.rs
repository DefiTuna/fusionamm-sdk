//
// Copyright (c) Cryptic Dot
//
// Modification based on Orca Whirlpools (https://github.com/orca-so/whirlpools),
// originally licensed under the Apache License, Version 2.0, prior to February 26, 2025.
//
// Modifications licensed under FusionAMM SDK Source-Available License v1.0
// See the LICENSE file in the project root for license information.
//

use crate::{
    get_limit_order_output_amount, sqrt_price_to_tick_index, tick_index_to_sqrt_price, try_apply_swap_fee, try_apply_transfer_fee,
    try_get_amount_delta_a, try_get_amount_delta_b, try_get_max_amount_with_slippage_tolerance, try_get_min_amount_with_slippage_tolerance,
    try_get_next_sqrt_price_from_a, try_get_next_sqrt_price_from_b, try_mul_div, try_reverse_apply_swap_fee, try_reverse_apply_transfer_fee,
    CoreError, ExactInSwapQuote, ExactOutSwapQuote, FusionPoolFacade, TickArraySequence, TickArrays, TickFacade, TransferFee, AMOUNT_EXCEEDS_MAX_U64,
    ARITHMETIC_OVERFLOW, FEE_RATE_MUL_VALUE, INVALID_SQRT_PRICE_LIMIT_DIRECTION, MAX_SQRT_PRICE, MIN_SQRT_PRICE, SQRT_PRICE_LIMIT_OUT_OF_BOUNDS,
    ZERO_TRADABLE_AMOUNT,
};

#[cfg(feature = "wasm")]
use fusionamm_macros::wasm_expose;

/// Computes the exact input or output amount for a swap transaction.
///
/// # Arguments
/// - `token_in`: The input token amount.
/// - `specified_token_a`: If `true`, the input token is token A. Otherwise, it is token B.
/// - `slippage_tolerance`: The slippage tolerance in basis points.
/// - `fusion_pool`: The fusion_pool state.
/// - `tick_arrays`: The tick arrays needed for the swap.
/// - `transfer_fee_a`: The transfer fee for token A.
/// - `transfer_fee_b`: The transfer fee for token B.
///
/// # Returns
/// The exact input or output amount for the swap transaction.
#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn swap_quote_by_input_token(
    token_in: u64,
    specified_token_a: bool,
    slippage_tolerance_bps: u16,
    fusion_pool: FusionPoolFacade,
    tick_arrays: TickArrays,
    transfer_fee_a: Option<TransferFee>,
    transfer_fee_b: Option<TransferFee>,
) -> Result<ExactInSwapQuote, CoreError> {
    let (transfer_fee_in, transfer_fee_out) = if specified_token_a {
        (transfer_fee_a, transfer_fee_b)
    } else {
        (transfer_fee_b, transfer_fee_a)
    };
    let token_in_after_fee = try_apply_transfer_fee(token_in.into(), transfer_fee_in.unwrap_or_default())?;

    let tick_sequence = TickArraySequence::new(tick_arrays.into(), fusion_pool.tick_spacing)?;

    let swap_result = compute_swap(token_in_after_fee.into(), 0, fusion_pool, tick_sequence, specified_token_a, true)?;

    let (token_in_after_fees, token_est_out_before_fee) = if specified_token_a {
        (swap_result.token_a, swap_result.token_b)
    } else {
        (swap_result.token_b, swap_result.token_a)
    };

    let token_in = try_reverse_apply_transfer_fee(token_in_after_fees, transfer_fee_in.unwrap_or_default())?;

    let token_est_out = try_apply_transfer_fee(token_est_out_before_fee, transfer_fee_out.unwrap_or_default())?;

    let token_min_out = try_get_min_amount_with_slippage_tolerance(token_est_out, slippage_tolerance_bps)?;

    Ok(ExactInSwapQuote {
        token_in,
        token_est_out,
        token_min_out,
        trade_fee: swap_result.fee_amount,
        next_sqrt_price: swap_result.next_sqrt_price,
    })
}

/// Computes the exact input or output amount for a swap transaction.
///
/// # Arguments
/// - `token_out`: The output token amount.
/// - `specified_token_a`: If `true`, the output token is token A. Otherwise, it is token B.
/// - `slippage_tolerance`: The slippage tolerance in basis points.
/// - `fusion_pool`: The fusion_pool state.
/// - `tick_arrays`: The tick arrays needed for the swap.
/// - `transfer_fee_a`: The transfer fee for token A.
/// - `transfer_fee_b`: The transfer fee for token B.
///
/// # Returns
/// The exact input or output amount for the swap transaction.
#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn swap_quote_by_output_token(
    token_out: u64,
    specified_token_a: bool,
    slippage_tolerance_bps: u16,
    fusion_pool: FusionPoolFacade,
    tick_arrays: TickArrays,
    transfer_fee_a: Option<TransferFee>,
    transfer_fee_b: Option<TransferFee>,
) -> Result<ExactOutSwapQuote, CoreError> {
    let (transfer_fee_in, transfer_fee_out) = if specified_token_a {
        (transfer_fee_b, transfer_fee_a)
    } else {
        (transfer_fee_a, transfer_fee_b)
    };
    let token_out_before_fee = try_reverse_apply_transfer_fee(token_out, transfer_fee_out.unwrap_or_default())?;

    let tick_sequence = TickArraySequence::new(tick_arrays.into(), fusion_pool.tick_spacing)?;

    let swap_result = compute_swap(token_out_before_fee.into(), 0, fusion_pool, tick_sequence, !specified_token_a, false)?;

    let (token_out_before_fee, token_est_in_after_fee) = if specified_token_a {
        (swap_result.token_a, swap_result.token_b)
    } else {
        (swap_result.token_b, swap_result.token_a)
    };

    let token_out = try_apply_transfer_fee(token_out_before_fee, transfer_fee_out.unwrap_or_default())?;

    let token_est_in = try_reverse_apply_transfer_fee(token_est_in_after_fee, transfer_fee_in.unwrap_or_default())?;

    let token_max_in = try_get_max_amount_with_slippage_tolerance(token_est_in, slippage_tolerance_bps)?;

    Ok(ExactOutSwapQuote {
        token_out,
        token_est_in,
        token_max_in,
        trade_fee: swap_result.fee_amount,
        next_sqrt_price: swap_result.next_sqrt_price,
    })
}

pub struct SwapResult {
    pub token_a: u64,
    pub token_b: u64,
    pub fee_amount: u64,
    pub next_sqrt_price: u128,
}

/// Computes the amounts of tokens A and B based on the current FusionPool state and tick sequence.
///
/// # Arguments
/// - `token_amount`: The input or output amount specified for the swap. Must be non-zero.
/// - `sqrt_price_limit`: The price limit for the swap represented as a square root. If set to `0`,
///   it defaults to the minimum or maximum sqrt price based on the direction of the swap.
/// - `fusion_pool`: The current state of the FusionPool AMM, including liquidity, price, and tick information.
/// - `tick_sequence`: A sequence of ticks used to determine price levels during the swap process.
/// - `a_to_b`: Indicates the direction of the swap:
///    - `true`: Swap from token A to token B.
///    - `false`: Swap from token B to token A.
/// - `specified_input`: Determines if the input amount is specified:
///    - `true`: `token_amount` represents the input amount.
///    - `false`: `token_amount` represents the output amount.
///
/// # Returns
/// A `Result` containing a `SwapResult` struct if the swap is successful, or an `ErrorCode` if the computation fails.
/// # Notes
/// - This function doesn't take into account slippage tolerance.
/// - This function doesn't take into account transfer fee extension.
pub fn compute_swap(
    token_amount: u64,
    sqrt_price_limit: u128,
    fusion_pool: FusionPoolFacade,
    tick_sequence: TickArraySequence,
    a_to_b: bool,
    specified_input: bool,
) -> Result<SwapResult, CoreError> {
    let sqrt_price_limit = if sqrt_price_limit == 0 {
        if a_to_b {
            MIN_SQRT_PRICE
        } else {
            MAX_SQRT_PRICE
        }
    } else {
        sqrt_price_limit
    };

    if !(MIN_SQRT_PRICE..=MAX_SQRT_PRICE).contains(&sqrt_price_limit) {
        return Err(SQRT_PRICE_LIMIT_OUT_OF_BOUNDS);
    }

    if a_to_b && sqrt_price_limit >= fusion_pool.sqrt_price || !a_to_b && sqrt_price_limit <= fusion_pool.sqrt_price {
        return Err(INVALID_SQRT_PRICE_LIMIT_DIRECTION);
    }

    if token_amount == 0 {
        return Err(ZERO_TRADABLE_AMOUNT);
    }

    let mut amount_remaining = token_amount;
    let mut amount_calculated = 0u64;
    let mut current_sqrt_price = fusion_pool.sqrt_price;
    let mut current_tick_index = fusion_pool.tick_current_index;
    let mut current_liquidity = fusion_pool.liquidity;
    let mut fee_amount = 0;

    while amount_remaining > 0 && sqrt_price_limit != current_sqrt_price {
        let (next_tick, next_tick_index) = if a_to_b {
            tick_sequence.prev_initialized_tick(current_tick_index)?
        } else {
            tick_sequence.next_initialized_tick(current_tick_index)?
        };
        let next_tick_sqrt_price: u128 = tick_index_to_sqrt_price(next_tick_index.into()).into();
        let target_sqrt_price = if a_to_b {
            next_tick_sqrt_price.max(sqrt_price_limit)
        } else {
            next_tick_sqrt_price.min(sqrt_price_limit)
        };

        let step_quote = compute_swap_step(
            amount_remaining,
            fusion_pool.fee_rate,
            current_liquidity,
            current_sqrt_price,
            target_sqrt_price,
            a_to_b,
            specified_input,
        )?;

        fee_amount += step_quote.fee_amount;

        if specified_input {
            amount_remaining = amount_remaining
                .checked_sub(step_quote.amount_in)
                .ok_or(ARITHMETIC_OVERFLOW)?
                .checked_sub(step_quote.fee_amount)
                .ok_or(ARITHMETIC_OVERFLOW)?;
            amount_calculated = amount_calculated.checked_add(step_quote.amount_out).ok_or(ARITHMETIC_OVERFLOW)?;
        } else {
            amount_remaining = amount_remaining.checked_sub(step_quote.amount_out).ok_or(ARITHMETIC_OVERFLOW)?;
            amount_calculated = amount_calculated
                .checked_add(step_quote.amount_in)
                .ok_or(ARITHMETIC_OVERFLOW)?
                .checked_add(step_quote.fee_amount)
                .ok_or(ARITHMETIC_OVERFLOW)?;
        }

        if step_quote.next_sqrt_price == next_tick_sqrt_price {
            let limit_swap_computation =
                fill_limit_orders(next_tick, next_tick_sqrt_price, a_to_b, specified_input, amount_remaining, fusion_pool.fee_rate)?;

            fee_amount += limit_swap_computation.fee_amount;

            if specified_input {
                amount_remaining = amount_remaining
                    .checked_sub(limit_swap_computation.amount_in)
                    .ok_or(ARITHMETIC_OVERFLOW)?
                    .checked_sub(limit_swap_computation.fee_amount)
                    .ok_or(ARITHMETIC_OVERFLOW)?;
                amount_calculated = amount_calculated
                    .checked_add(limit_swap_computation.amount_out)
                    .ok_or(ARITHMETIC_OVERFLOW)?;
            } else {
                amount_remaining = amount_remaining
                    .checked_sub(limit_swap_computation.amount_out)
                    .ok_or(ARITHMETIC_OVERFLOW)?;
                amount_calculated = amount_calculated
                    .checked_add(limit_swap_computation.amount_in)
                    .ok_or(ARITHMETIC_OVERFLOW)?
                    .checked_add(limit_swap_computation.fee_amount)
                    .ok_or(ARITHMETIC_OVERFLOW)?;
            };

            current_liquidity = get_next_liquidity(current_liquidity, next_tick, a_to_b);
            current_tick_index = if a_to_b { next_tick_index - 1 } else { next_tick_index }
        } else if step_quote.next_sqrt_price != current_sqrt_price {
            current_tick_index = sqrt_price_to_tick_index(step_quote.next_sqrt_price.into()).into();
        }

        current_sqrt_price = step_quote.next_sqrt_price;
    }

    let swapped_amount = token_amount - amount_remaining;

    let token_a = if a_to_b == specified_input { swapped_amount } else { amount_calculated };
    let token_b = if a_to_b == specified_input { amount_calculated } else { swapped_amount };

    Ok(SwapResult {
        token_a,
        token_b,
        fee_amount,
        next_sqrt_price: current_sqrt_price,
    })
}

pub(crate) fn get_next_liquidity(current_liquidity: u128, next_tick: Option<TickFacade>, a_to_b: bool) -> u128 {
    let liquidity_net = next_tick.map(|tick| tick.liquidity_net).unwrap_or(0);
    let liquidity_net_unsigned = liquidity_net.unsigned_abs();
    if a_to_b {
        if liquidity_net < 0 {
            current_liquidity + liquidity_net_unsigned
        } else {
            current_liquidity - liquidity_net_unsigned
        }
    } else if liquidity_net < 0 {
        current_liquidity - liquidity_net_unsigned
    } else {
        current_liquidity + liquidity_net_unsigned
    }
}

// Private functions

#[derive(PartialEq, Debug, Default)]
pub struct LimitSwapComputation {
    pub amount_in: u64,
    pub fee_amount: u64,
    pub amount_out: u64,
}

fn fill_limit_orders(
    tick: Option<TickFacade>,
    sqrt_price: u128,
    a_to_b: bool,
    amount_specified_is_input: bool,
    amount_remaining: u64,
    fee_rate: u16,
) -> Result<LimitSwapComputation, CoreError> {
    let mut result = LimitSwapComputation::default();

    if let Some(tick) = tick {
        let part_filled_orders_remaining_input = tick.open_orders_input + tick.part_filled_orders_remaining_input;

        if amount_specified_is_input {
            // Total possible swap input.
            result.amount_in = get_limit_order_output_amount(part_filled_orders_remaining_input, !a_to_b, sqrt_price, true)?;
            // The total amount of the limit order input token that can be swapped.
            result.amount_out = part_filled_orders_remaining_input;
            // Swap fee in input token.
            result.fee_amount = try_mul_div(result.amount_in, fee_rate as u128, FEE_RATE_MUL_VALUE as u128 - fee_rate as u128, true)?;

            // Not enough input remaining amount to fill all limit orders of the tick.
            if amount_remaining < result.amount_in + result.fee_amount {
                let total_available_amount_in = result.amount_in;

                // Swap fee in input token.
                result.fee_amount = try_mul_div(amount_remaining, fee_rate as u128, FEE_RATE_MUL_VALUE as u128, true)?;

                // Total possible swap input minus fee amount.
                result.amount_in = amount_remaining - result.fee_amount;

                // Swap output
                result.amount_out =
                    try_mul_div(part_filled_orders_remaining_input, result.amount_in as u128, total_available_amount_in as u128, false)?;
            }
        } else {
            // The total amount of the limit order input token that can be swapped.
            result.amount_out = part_filled_orders_remaining_input.min(amount_remaining);
            // Swap input
            result.amount_in = get_limit_order_output_amount(result.amount_out, !a_to_b, sqrt_price, true)?;
            result.fee_amount = try_mul_div(result.amount_in, fee_rate as u128, FEE_RATE_MUL_VALUE as u128 - fee_rate as u128, true)?;
        }
    }

    Ok(result)
}

struct SwapStepQuote {
    amount_in: u64,
    amount_out: u64,
    next_sqrt_price: u128,
    fee_amount: u64,
}

fn compute_swap_step(
    amount_remaining: u64,
    fee_rate: u16,
    current_liquidity: u128,
    current_sqrt_price: u128,
    target_sqrt_price: u128,
    a_to_b: bool,
    specified_input: bool,
) -> Result<SwapStepQuote, CoreError> {
    // Any error that is not AMOUNT_EXCEEDS_MAX_U64 is not recoverable
    let initial_amount_fixed_delta = try_get_amount_fixed_delta(current_sqrt_price, target_sqrt_price, current_liquidity, a_to_b, specified_input);
    let is_initial_amount_fixed_overflow = initial_amount_fixed_delta == Err(AMOUNT_EXCEEDS_MAX_U64);

    let amount_calculated = if specified_input {
        try_apply_swap_fee(amount_remaining.into(), fee_rate)?
    } else {
        amount_remaining
    };

    let next_sqrt_price = if !is_initial_amount_fixed_overflow && initial_amount_fixed_delta? <= amount_calculated {
        target_sqrt_price
    } else {
        try_get_next_sqrt_price(current_sqrt_price, current_liquidity, amount_calculated, a_to_b, specified_input)?
    };

    let is_max_swap = next_sqrt_price == target_sqrt_price;

    let amount_unfixed_delta = try_get_amount_unfixed_delta(current_sqrt_price, next_sqrt_price, current_liquidity, a_to_b, specified_input)?;

    // If the swap is not at the max, we need to readjust the amount of the fixed token we are using
    let amount_fixed_delta = if !is_max_swap || is_initial_amount_fixed_overflow {
        try_get_amount_fixed_delta(current_sqrt_price, next_sqrt_price, current_liquidity, a_to_b, specified_input)?
    } else {
        initial_amount_fixed_delta?
    };

    let (amount_in, mut amount_out) = if specified_input {
        (amount_fixed_delta, amount_unfixed_delta)
    } else {
        (amount_unfixed_delta, amount_fixed_delta)
    };

    // Cap output amount if using output
    if !specified_input && amount_out > amount_remaining {
        amount_out = amount_remaining;
    }

    let fee_amount = if specified_input && !is_max_swap {
        amount_remaining - amount_in
    } else {
        let pre_fee_amount = try_reverse_apply_swap_fee(amount_in.into(), fee_rate)?;
        pre_fee_amount - amount_in
    };

    Ok(SwapStepQuote {
        amount_in,
        amount_out,
        next_sqrt_price,
        fee_amount,
    })
}

fn try_get_amount_fixed_delta(
    current_sqrt_price: u128,
    target_sqrt_price: u128,
    current_liquidity: u128,
    a_to_b: bool,
    specified_input: bool,
) -> Result<u64, CoreError> {
    if a_to_b == specified_input {
        try_get_amount_delta_a(current_sqrt_price.into(), target_sqrt_price.into(), current_liquidity.into(), specified_input)
    } else {
        try_get_amount_delta_b(current_sqrt_price.into(), target_sqrt_price.into(), current_liquidity.into(), specified_input)
    }
}

fn try_get_amount_unfixed_delta(
    current_sqrt_price: u128,
    target_sqrt_price: u128,
    current_liquidity: u128,
    a_to_b: bool,
    specified_input: bool,
) -> Result<u64, CoreError> {
    if specified_input == a_to_b {
        try_get_amount_delta_b(current_sqrt_price.into(), target_sqrt_price.into(), current_liquidity.into(), !specified_input)
    } else {
        try_get_amount_delta_a(current_sqrt_price.into(), target_sqrt_price.into(), current_liquidity.into(), !specified_input)
    }
}

fn try_get_next_sqrt_price(
    current_sqrt_price: u128,
    current_liquidity: u128,
    amount_calculated: u64,
    a_to_b: bool,
    specified_input: bool,
) -> Result<u128, CoreError> {
    if specified_input == a_to_b {
        try_get_next_sqrt_price_from_a(current_sqrt_price.into(), current_liquidity.into(), amount_calculated.into(), specified_input)
            .map(|x| x.into())
    } else {
        try_get_next_sqrt_price_from_b(current_sqrt_price.into(), current_liquidity.into(), amount_calculated.into(), specified_input)
            .map(|x| x.into())
    }
}

#[cfg(all(test, not(feature = "wasm")))]
mod tests {
    use crate::{TickArrayFacade, INVALID_TICK_ARRAY_SEQUENCE, TICK_ARRAY_SIZE};

    use super::*;

    fn test_fusion_pool(sqrt_price: u128, sufficient_liq: bool) -> FusionPoolFacade {
        let tick_current_index = sqrt_price_to_tick_index(sqrt_price);
        let liquidity = if sufficient_liq { 100000000 } else { 265000 };
        FusionPoolFacade {
            tick_current_index,
            fee_rate: 3000,
            liquidity,
            sqrt_price,
            tick_spacing: 2,
            ..FusionPoolFacade::default()
        }
    }

    fn test_fusion_pool_with_zero_liquidity(sqrt_price: u128) -> FusionPoolFacade {
        let tick_current_index = sqrt_price_to_tick_index(sqrt_price);
        FusionPoolFacade {
            tick_current_index,
            fee_rate: 10000,
            protocol_fee_rate: 1000,
            liquidity: 0,
            sqrt_price,
            tick_spacing: 2,
            ..FusionPoolFacade::default()
        }
    }

    fn test_tick(liquidity_net: i128, limit_amount: u64) -> TickFacade {
        TickFacade {
            initialized: true,
            liquidity_net,
            part_filled_orders_input: limit_amount,
            part_filled_orders_remaining_input: limit_amount,
            ..TickFacade::default()
        }
    }

    fn test_tick_array(start_tick_index: i32) -> TickArrayFacade {
        let liquidity_net = if start_tick_index < 0 { 1000 } else { -1000 };
        TickArrayFacade {
            start_tick_index,
            ticks: [test_tick(liquidity_net, 0); TICK_ARRAY_SIZE],
        }
    }

    fn test_tick_array_with_orders(start_tick_index: i32) -> TickArrayFacade {
        TickArrayFacade {
            start_tick_index,
            ticks: [test_tick(0, 10000); TICK_ARRAY_SIZE],
        }
    }

    fn test_tick_arrays() -> TickArrays {
        [
            test_tick_array(0),
            test_tick_array(176),
            test_tick_array(352),
            test_tick_array(-176),
            test_tick_array(-352),
        ]
        .into()
    }

    fn test_tick_arrays_with_orders() -> TickArrays {
        [
            test_tick_array_with_orders(0),
            test_tick_array_with_orders(176),
            test_tick_array_with_orders(352),
            test_tick_array_with_orders(-176),
            test_tick_array_with_orders(-352),
        ]
        .into()
    }

    #[test]
    fn test_exact_in_a_to_b_simple() {
        let result = swap_quote_by_input_token(1000, true, 1000, test_fusion_pool(1 << 64, true), test_tick_arrays(), None, None).unwrap();
        assert_eq!(result.token_in, 1000);
        assert_eq!(result.token_est_out, 996);
        assert_eq!(result.token_min_out, 896);
        assert_eq!(result.trade_fee, 3);
        assert_eq!(result.next_sqrt_price, 18446560163343826736);
    }

    #[test]
    fn test_exact_in_a_to_b() {
        let result = swap_quote_by_input_token(1000, true, 1000, test_fusion_pool(1 << 64, false), test_tick_arrays(), None, None).unwrap();
        assert_eq!(result.token_in, 1000);
        assert_eq!(result.token_est_out, 920);
        assert_eq!(result.token_min_out, 828);
        assert_eq!(result.trade_fee, 38);
        assert_eq!(result.next_sqrt_price, 18376782954535863426);
    }

    #[test]
    fn test_exact_in_b_to_a_simple() {
        let result = swap_quote_by_input_token(1000, false, 1000, test_fusion_pool(1 << 64, true), test_tick_arrays(), None, None).unwrap();
        assert_eq!(result.token_in, 1000);
        assert_eq!(result.token_est_out, 996);
        assert_eq!(result.token_min_out, 896);
        assert_eq!(result.trade_fee, 3);
        assert_eq!(result.next_sqrt_price, 18446927987747966500);
    }

    #[test]
    fn test_exact_in_b_to_a() {
        let result = swap_quote_by_input_token(1000, false, 1000, test_fusion_pool(1 << 64, false), test_tick_arrays(), None, None).unwrap();
        assert_eq!(result.token_in, 1000);
        assert_eq!(result.token_est_out, 918);
        assert_eq!(result.token_min_out, 826);
        assert_eq!(result.trade_fee, 39);
        assert_eq!(result.next_sqrt_price, 18517215327122732453);
    }

    #[test]
    fn test_exact_out_a_to_b_simple() {
        let result = swap_quote_by_output_token(1000, false, 1000, test_fusion_pool(1 << 64, true), test_tick_arrays(), None, None).unwrap();
        assert_eq!(result.token_out, 1000);
        assert_eq!(result.token_est_in, 1005);
        assert_eq!(result.token_max_in, 1106);
        assert_eq!(result.trade_fee, 4);
        assert_eq!(result.next_sqrt_price, 18446559608113470481);
    }

    #[test]
    fn test_exact_out_a_to_b() {
        let result = swap_quote_by_output_token(1000, false, 1000, test_fusion_pool(1 << 64, false), test_tick_arrays(), None, None).unwrap();
        assert_eq!(result.token_out, 1000);
        assert_eq!(result.token_est_in, 1088);
        assert_eq!(result.token_max_in, 1197);
        assert_eq!(result.trade_fee, 42);
        assert_eq!(result.next_sqrt_price, 18370123224663708854);
    }

    #[test]
    fn test_exact_out_b_to_a_simple() {
        let result = swap_quote_by_output_token(1000, true, 1000, test_fusion_pool(1 << 64, true), test_tick_arrays(), None, None).unwrap();
        assert_eq!(result.token_out, 1000);
        assert_eq!(result.token_est_in, 1005);
        assert_eq!(result.token_max_in, 1106);
        assert_eq!(result.trade_fee, 4);
        assert_eq!(result.next_sqrt_price, 18446928542994981566);
    }

    #[test]
    fn test_exact_out_b_to_a() {
        let result = swap_quote_by_output_token(1000, true, 1000, test_fusion_pool(1 << 64, false), test_tick_arrays(), None, None).unwrap();
        assert_eq!(result.token_out, 1000);
        assert_eq!(result.token_est_in, 1088);
        assert_eq!(result.token_max_in, 1197);
        assert_eq!(result.trade_fee, 42);
        assert_eq!(result.next_sqrt_price, 18524021837236982510);
    }

    #[test]
    /// The test is equal to swap_manager::swap_with_limit_orders_tests::test_for_swap_quote_zero_liquidity_a_to_b_exact_in() in FusionAMM program.
    fn test_exact_in_a_to_b_with_orders() {
        let result =
            swap_quote_by_input_token(85000, true, 1000, test_fusion_pool_with_zero_liquidity(1 << 64), test_tick_arrays_with_orders(), None, None)
                .unwrap();
        assert_eq!(result.token_in, 85000);
        assert_eq!(result.token_est_out, 84072);
        assert_eq!(result.token_min_out, 75664);
        assert_eq!(result.trade_fee, 858);
        assert_eq!(result.next_sqrt_price, 18431993317065449817);
    }

    #[test]
    /// The test is equal to swap_manager::swap_with_limit_orders_tests::test_for_swap_quote_zero_liquidity_a_to_b_exact_out() in FusionAMM program.
    fn test_exact_out_a_to_b_with_orders() {
        let result =
            swap_quote_by_output_token(85000, false, 1000, test_fusion_pool_with_zero_liquidity(1 << 64), test_tick_arrays_with_orders(), None, None)
                .unwrap();
        assert_eq!(result.token_out, 85000);
        assert_eq!(result.token_est_in, 85939);
        assert_eq!(result.token_max_in, 94533);
        assert_eq!(result.trade_fee, 867);
        assert_eq!(result.next_sqrt_price, 18431993317065449817);
    }

    #[test]
    /// The test is equal to swap_manager::swap_with_limit_orders_tests::test_for_swap_quote_zero_liquidity_b_to_a_exact_in() in FusionAMM program.
    fn test_exact_in_b_to_a_with_orders() {
        let result =
            swap_quote_by_input_token(85000, false, 1000, test_fusion_pool_with_zero_liquidity(1 << 64), test_tick_arrays_with_orders(), None, None)
                .unwrap();
        assert_eq!(result.token_in, 85000);
        assert_eq!(result.token_est_out, 84054);
        assert_eq!(result.token_min_out, 75648);
        assert_eq!(result.trade_fee, 858);
        assert_eq!(result.next_sqrt_price, 18463352785753515702);
    }

    #[test]
    /// The test is equal to swap_manager::swap_with_limit_orders_tests::test_for_swap_quote_zero_liquidity_b_to_a_exact_out() in FusionAMM program.
    fn test_exact_out_b_to_a_with_orders() {
        let result =
            swap_quote_by_output_token(85000, true, 1000, test_fusion_pool_with_zero_liquidity(1 << 64), test_tick_arrays_with_orders(), None, None)
                .unwrap();
        assert_eq!(result.token_out, 85000);
        assert_eq!(result.token_est_in, 85957);
        assert_eq!(result.token_max_in, 94553);
        assert_eq!(result.trade_fee, 867);
        assert_eq!(result.next_sqrt_price, 18463352785753515702);
    }

    #[test]
    fn test_swap_quote_throws_if_tick_array_sequence_holds_insufficient_liquidity() {
        let result_3428 = swap_quote_by_input_token(3428, true, 0, test_fusion_pool(1 << 64, false), test_tick_arrays(), None, None).unwrap();
        let result_3429 = swap_quote_by_input_token(3429, true, 0, test_fusion_pool(1 << 64, false), test_tick_arrays(), None, None);
        assert_eq!(result_3428.token_in, 3428);
        assert!(matches!(result_3429, Err(INVALID_TICK_ARRAY_SEQUENCE)));
    }
}
