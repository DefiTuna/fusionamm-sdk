//
// Copyright (c) Cryptic Dot
//
// Modification based on Orca Whirlpools (https://github.com/orca-so/whirlpools),
// originally licensed under the Apache License, Version 2.0, prior to February 26, 2025.
//
// Modifications licensed under FusionAMM SDK Source-Available License v1.0
// See the LICENSE file in the project root for license information.
//
use crate::{PositionRatio, PositionStatus};

use ethnum::U256;
#[cfg(feature = "wasm")]
use fusionamm_macros::wasm_expose;

use super::{order_tick_indexes, tick_index_to_sqrt_price};

/// Check if a position is in range.
/// When a position is in range it is earning fees and rewards
///
/// # Parameters
/// - `sqrt_price` - A u128 integer representing the sqrt price of the pool
/// - `tick_index_1` - A i32 integer representing the first tick index of the position
/// - `tick_index_2` - A i32 integer representing the second tick index of the position
///
/// # Returns
/// - A boolean value indicating if the position is in range
#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn is_position_in_range(current_sqrt_price: u128, tick_index_1: i32, tick_index_2: i32) -> bool {
    position_status(current_sqrt_price, tick_index_1, tick_index_2) == PositionStatus::PriceInRange
}

/// Calculate the status of a position
/// The status can be one of three values:
/// - InRange: The position is in range
/// - BelowRange: The position is below the range
/// - AboveRange: The position is above the range
///
/// # Parameters
/// - `sqrt_price` - A u128 integer representing the sqrt price of the pool
/// - `tick_index_1` - A i32 integer representing the first tick index of the position
/// - `tick_index_2` - A i32 integer representing the second tick index of the position
///
/// # Returns
/// - A PositionStatus enum value indicating the status of the position
#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn position_status(current_sqrt_price: u128, tick_index_1: i32, tick_index_2: i32) -> PositionStatus {
    let tick_range = order_tick_indexes(tick_index_1, tick_index_2);
    let sqrt_price_lower = tick_index_to_sqrt_price(tick_range.tick_lower_index);
    let sqrt_price_upper = tick_index_to_sqrt_price(tick_range.tick_upper_index);

    if tick_index_1 == tick_index_2 {
        PositionStatus::Invalid
    } else if current_sqrt_price <= sqrt_price_lower {
        PositionStatus::PriceBelowRange
    } else if current_sqrt_price >= sqrt_price_upper {
        PositionStatus::PriceAboveRange
    } else {
        PositionStatus::PriceInRange
    }
}

/// Calculate the token_a / token_b ratio of a (ficticious) position
///
/// # Parameters
/// - `sqrt_price` - A u128 integer representing the sqrt price of the pool
/// - `tick_index_1` - A i32 integer representing the first tick index of the position
/// - `tick_index_2` - A i32 integer representing the second tick index of the position
///
/// # Returns
/// - A PositionRatio struct containing the ratio of token_a and token_b
#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn position_ratio_x64(current_sqrt_price: u128, tick_index_1: i32, tick_index_2: i32) -> PositionRatio {
    let one_x64: u128 = 1 << 64;
    let position_status = position_status(current_sqrt_price, tick_index_1, tick_index_2);
    match position_status {
        PositionStatus::Invalid => PositionRatio { ratio_a: 0, ratio_b: 0 },
        PositionStatus::PriceBelowRange => PositionRatio {
            ratio_a: one_x64,
            ratio_b: 0,
        },
        PositionStatus::PriceAboveRange => PositionRatio {
            ratio_a: 0,
            ratio_b: one_x64,
        },
        PositionStatus::PriceInRange => {
            let tick_range = order_tick_indexes(tick_index_1, tick_index_2);
            let lower_sqrt_price = tick_index_to_sqrt_price(tick_range.tick_lower_index);
            let upper_sqrt_price = tick_index_to_sqrt_price(tick_range.tick_upper_index);

            let l: U256 = <U256>::from(1u16) << 64;
            let p = <U256>::from(current_sqrt_price) * <U256>::from(current_sqrt_price);

            let deposit_a_1: U256 = (l << 64) / current_sqrt_price;
            let deposit_a_2: U256 = (l << 64) / upper_sqrt_price;
            let deposit_a: U256 = ((deposit_a_1 - deposit_a_2) * p) >> 64;

            let deposit_b_1 = current_sqrt_price - lower_sqrt_price;
            let deposit_b = l * deposit_b_1;

            let total_deposit: U256 = deposit_a + deposit_b;

            let ratio_a: u128 = ((deposit_a * <U256>::from(one_x64)) / total_deposit).as_u128();
            let ratio_b: u128 = one_x64 - ratio_a;

            PositionRatio { ratio_a, ratio_b }
        }
    }
}

#[cfg(all(test, not(feature = "wasm")))]
mod test {
    use super::*;
    use crate::{price_to_sqrt_price, price_to_tick_index};

    #[test]
    fn test_is_position_in_range() {
        assert!(is_position_in_range(18446744073709551616, -5, 5));
        assert!(!is_position_in_range(18446744073709551616, 0, 5));
        assert!(!is_position_in_range(18446744073709551616, -5, 0));
        assert!(!is_position_in_range(18446744073709551616, -5, -1));
        assert!(!is_position_in_range(18446744073709551616, 1, 5));
    }

    #[test]
    fn test_position_status() {
        assert_eq!(position_status(18354745142194483560, -100, 100), PositionStatus::PriceBelowRange);
        assert_eq!(position_status(18354745142194483561, -100, 100), PositionStatus::PriceBelowRange);
        assert_eq!(position_status(18354745142194483562, -100, 100), PositionStatus::PriceInRange);
        assert_eq!(position_status(18446744073709551616, -100, 100), PositionStatus::PriceInRange);
        assert_eq!(position_status(18539204128674405811, -100, 100), PositionStatus::PriceInRange);
        assert_eq!(position_status(18539204128674405812, -100, 100), PositionStatus::PriceAboveRange);
        assert_eq!(position_status(18539204128674405813, -100, 100), PositionStatus::PriceAboveRange);
        assert_eq!(position_status(18446744073709551616, 100, 100), PositionStatus::Invalid);
    }

    #[test]
    fn test_position_ratio_x64() {
        let ratio_1 = position_ratio_x64(18354745142194483561, -100, 100);
        assert_eq!(ratio_1.ratio_a, 1 << 64);
        assert_eq!(ratio_1.ratio_b, 0);

        let ratio_2 = position_ratio_x64(18446744073709551616, -100, 100);
        assert_eq!(ratio_2.ratio_a, 9223372036854775707); // <50%
        assert_eq!(ratio_2.ratio_b, 9223372036854775909); // >50%

        let ratio_3 = position_ratio_x64(18539204128674405812, -100, 100);
        assert_eq!(ratio_3.ratio_a, 0);
        assert_eq!(ratio_3.ratio_b, 1 << 64);

        let ratio_4 = position_ratio_x64(18446744073709551616, 0, 0);
        assert_eq!(ratio_4.ratio_a, 0);
        assert_eq!(ratio_4.ratio_b, 0);

        let ratio_5 = position_ratio_x64(7267764841821948241, -21136, -17240);
        assert_eq!(ratio_5.ratio_a, 6696687687134031069);
        assert_eq!(ratio_5.ratio_b, 11750056386575520547);

        let ratio_6 = position_ratio_x64(
            price_to_sqrt_price(500000000.0, 1, 1),
            price_to_tick_index(250000000.0, 1, 1),
            price_to_tick_index(1000000000.0, 1, 1),
        );
        assert_eq!(ratio_6.ratio_a, 9223147761756382767);
        assert_eq!(ratio_6.ratio_b, 9223596311953168849);
    }
}
