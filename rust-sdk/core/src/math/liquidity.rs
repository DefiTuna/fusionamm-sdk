//
// Copyright (c) Cryptic Dot
//
// Modification based on Orca Whirlpools (https://github.com/orca-so/whirlpools),
// originally licensed under the Apache License, Version 2.0, prior to February 26, 2025.
//
// Modifications licensed under FusionAMM SDK Source-Available License v1.0
// See the LICENSE file in the project root for license information.
//

#[cfg(feature = "wasm")]
use fusionamm_macros::wasm_expose;

use crate::{CoreError, AMOUNT_EXCEEDS_MAX_U64, ARITHMETIC_OVERFLOW, INVALID_RANGE_BOUNDS};
use ethnum::U256;

#[derive(Copy, Clone, Debug, PartialEq, Eq, Default)]
#[cfg_attr(feature = "wasm", wasm_expose)]
pub struct TokenPair {
    pub a: u64,
    pub b: u64,
}

#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn get_liquidity_from_amount_a(amount_a: u64, sqrt_price_lower: u128, sqrt_price_upper: u128) -> Result<u128, CoreError> {
    let sqrt_price_diff = sqrt_price_upper - sqrt_price_lower;
    let mul: U256 = <U256>::from(amount_a)
        .checked_mul(sqrt_price_lower.into())
        .ok_or(ARITHMETIC_OVERFLOW)?
        .checked_mul(sqrt_price_upper.into())
        .ok_or(ARITHMETIC_OVERFLOW)?;
    let result: U256 = (mul / sqrt_price_diff) >> 64;
    result.try_into().map_err(|_| AMOUNT_EXCEEDS_MAX_U64)
}

#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn get_liquidity_from_amount_b(amount_b: u64, sqrt_price_lower: u128, sqrt_price_upper: u128) -> Result<u128, CoreError> {
    let numerator: U256 = <U256>::from(amount_b).checked_shl(64).ok_or(ARITHMETIC_OVERFLOW)?;
    let sqrt_price_diff = sqrt_price_upper - sqrt_price_lower;
    let result = numerator / <U256>::from(sqrt_price_diff);
    result.try_into().map_err(|_| AMOUNT_EXCEEDS_MAX_U64)
}

#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn get_amount_a_from_liquidity(liquidity: u128, sqrt_price_lower: u128, sqrt_price_upper: u128, round_up: bool) -> Result<u64, CoreError> {
    let sqrt_price_diff = sqrt_price_upper - sqrt_price_lower;
    let numerator: U256 = <U256>::from(liquidity)
        .checked_mul(sqrt_price_diff.into())
        .ok_or(ARITHMETIC_OVERFLOW)?
        .checked_shl(64)
        .ok_or(ARITHMETIC_OVERFLOW)?;
    let denominator = <U256>::from(sqrt_price_upper)
        .checked_mul(<U256>::from(sqrt_price_lower))
        .ok_or(ARITHMETIC_OVERFLOW)?;
    let quotient = numerator / denominator;
    let remainder = numerator % denominator;

    let result = if round_up && remainder != 0 { quotient + 1 } else { quotient };
    result.try_into().map_err(|_| AMOUNT_EXCEEDS_MAX_U64)
}

#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn get_amount_b_from_liquidity(liquidity: u128, sqrt_price_lower: u128, sqrt_price_upper: u128, round_up: bool) -> Result<u64, CoreError> {
    let sqrt_price_diff = sqrt_price_upper - sqrt_price_lower;
    let mul: U256 = <U256>::from(liquidity).checked_mul(sqrt_price_diff.into()).ok_or(ARITHMETIC_OVERFLOW)?;
    let result: U256 = mul >> 64;
    if round_up && mul & <U256>::from(u64::MAX) > 0 {
        (result + 1).try_into().map_err(|_| AMOUNT_EXCEEDS_MAX_U64)
    } else {
        result.try_into().map_err(|_| AMOUNT_EXCEEDS_MAX_U64)
    }
}

#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn get_amounts_from_liquidity(
    liquidity: u128,
    sqrt_price: u128,
    sqrt_price_lower: u128,
    sqrt_price_upper: u128,
    round_up: bool,
) -> Result<TokenPair, CoreError> {
    if liquidity == 0 {
        return Ok(TokenPair { a: 0, b: 0 });
    }

    if sqrt_price_lower > sqrt_price_upper {
        return Err(INVALID_RANGE_BOUNDS);
    }

    if sqrt_price_lower == sqrt_price_upper {
        Ok(TokenPair { a: 0, b: 0 })
    } else if sqrt_price <= sqrt_price_lower {
        let amount_a = get_amount_a_from_liquidity(liquidity, sqrt_price_lower, sqrt_price_upper, round_up)?;
        Ok(TokenPair { a: amount_a, b: 0 })
    } else if sqrt_price >= sqrt_price_upper {
        let amount_b = get_amount_b_from_liquidity(liquidity, sqrt_price_lower, sqrt_price_upper, round_up)?;
        Ok(TokenPair { a: 0, b: amount_b })
    } else {
        let amount_a = get_amount_a_from_liquidity(liquidity, sqrt_price, sqrt_price_upper, round_up)?;
        let amount_b = get_amount_b_from_liquidity(liquidity, sqrt_price_lower, sqrt_price, round_up)?;
        Ok(TokenPair { a: amount_a, b: amount_b })
    }
}

#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn get_liquidity_from_amounts(
    sqrt_price: u128,
    sqrt_price_lower: u128,
    sqrt_price_upper: u128,
    amount_a: u64,
    amount_b: u64,
) -> Result<u128, CoreError> {
    if sqrt_price_lower > sqrt_price_upper {
        return Err(INVALID_RANGE_BOUNDS);
    }

    if sqrt_price <= sqrt_price_lower {
        get_liquidity_from_amount_a(amount_a, sqrt_price_lower, sqrt_price_upper)
    } else if sqrt_price < sqrt_price_upper {
        let liquidity_a = get_liquidity_from_amount_a(amount_a, sqrt_price, sqrt_price_upper)?;
        let liquidity_b = get_liquidity_from_amount_b(amount_b, sqrt_price_lower, sqrt_price)?;
        Ok(u128::min(liquidity_a, liquidity_b))
    } else {
        get_liquidity_from_amount_b(amount_b, sqrt_price_lower, sqrt_price_upper)
    }
}

#[cfg(all(test, not(feature = "wasm")))]
mod tests {
    use crate::{get_amount_a_from_liquidity, get_amount_b_from_liquidity};

    #[test]
    fn test_get_amount_delta_a() {
        assert_eq!(get_amount_a_from_liquidity(4, 2 << 64, 4 << 64, true), Ok(1));
        assert_eq!(get_amount_a_from_liquidity(4, 2 << 64, 4 << 64, false), Ok(1));

        assert_eq!(get_amount_a_from_liquidity(4, 4 << 64, 4 << 64, true), Ok(0));
        assert_eq!(get_amount_a_from_liquidity(4, 4 << 64, 4 << 64, false), Ok(0));
    }

    #[test]
    fn test_get_amount_delta_b() {
        assert_eq!(get_amount_b_from_liquidity(4, 2 << 64, 4 << 64, true), Ok(8));
        assert_eq!(get_amount_b_from_liquidity(4, 2 << 64, 4 << 64, false), Ok(8));

        assert_eq!(get_amount_b_from_liquidity(4, 4 << 64, 4 << 64, true), Ok(0));
        assert_eq!(get_amount_b_from_liquidity(4, 4 << 64, 4 << 64, false), Ok(0));
    }
}
