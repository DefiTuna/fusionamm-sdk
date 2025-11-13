//
// Copyright (c) Cryptic Dot
//
// Licensed under FusionAMM SDK Source-Available License v1.0
// See the LICENSE file in the project root for license information.
//

use crate::quote::get_next_liquidity;
use crate::{
    get_limit_order_output_amount, price_to_sqrt_price, sqrt_price_to_price, tick_index_to_sqrt_price, CoreError, FusionPoolFacade,
    TickArraySequence, MAX_SQRT_PRICE, MIN_SQRT_PRICE,
};

#[derive(Debug)]
pub struct OrderBookEntry {
    pub concentrated_amount: u64,
    pub concentrated_amount_quote: u64,
    pub concentrated_total: u64,
    pub concentrated_total_quote: u64,
    pub limit_amount: u64,
    pub limit_amount_quote: u64,
    pub limit_total: u64,
    pub limit_total_quote: u64,
    pub price: f64,
    /// True for the ASK side of an order book and false for the BID one.
    /// ASK-side liquidity is denominated in token A. Quote amounts indicate how much of token B you need to spend to purchase the available liquidity (swap fees not included).
    /// BID-side liquidity is denominated in token B. Quote amounts indicate how much of token A you need to spend to purchase the available liquidity (swap fees not included).
    pub ask_side: bool,
}

/// Calculate order book entries with the provided price step.
///
/// # Parameters
/// - `fusion_pool`: The fusion_pool state
/// - `tick_arrays`: The tick sequence
/// - `price_step` - The price step of an order book. Should be positive for the BID side of an order book and negative for the ASK side.
/// - `max_num_entries` - The maximum number of entries.
/// - `invert_price` - Set to true if the provided price step is for inverted pool price.
/// - `decimals_a` - The number of decimals of token A.
/// - `decimals_b` - The number of decimals of token B.
///
/// # Returns
/// - Order book entries for one side of the order book.
pub fn get_order_book_side(
    fusion_pool: &FusionPoolFacade,
    tick_sequence: &TickArraySequence,
    price_step: f64,
    max_num_entries: u32,
    invert_price: bool,
    decimals_a: u8,
    decimals_b: u8,
) -> Result<Vec<OrderBookEntry>, CoreError> {
    let price_step_abs = price_step.abs();
    assert!(price_step_abs >= 0.0000000000001, "price_step is too small");
    assert!(max_num_entries <= 100, "the maximum allowed number of entries is too large");

    // a_to_b is false (ASK side) if the price_step is positive and not inverted.
    let a_to_b = (price_step < 0.0) != invert_price;

    let mut current_price = sqrt_price_to_price(fusion_pool.sqrt_price.into(), decimals_a, decimals_b);
    if invert_price {
        current_price = 1.0 / current_price;
    }

    let mut next_order_book_price = if price_step > 0.0 {
        (current_price / price_step_abs).floor() * price_step_abs
    } else {
        (current_price / price_step_abs).ceil() * price_step_abs
    };

    let mut current_sqrt_price = fusion_pool.sqrt_price;
    let mut current_tick_index = fusion_pool.tick_current_index;
    let mut current_liquidity = fusion_pool.liquidity;

    let mut concentrated_total = 0;
    let mut concentrated_total_quote = 0;
    let mut limit_total = 0;
    let mut limit_total_quote = 0;
    let mut order_book_entries: Vec<OrderBookEntry> = vec![];

    let min_price = sqrt_price_to_price(MIN_SQRT_PRICE.into(), decimals_a, decimals_b);
    let max_price = sqrt_price_to_price(MAX_SQRT_PRICE.into(), decimals_a, decimals_b);

    loop {
        if current_price == min_price || current_price == max_price || order_book_entries.len() >= max_num_entries as usize {
            return Ok(order_book_entries);
        }

        next_order_book_price = (next_order_book_price + price_step).clamp(min_price, max_price);

        let next_order_book_sqrt_price = u128::from(price_to_sqrt_price(
            if invert_price {
                1.0 / next_order_book_price
            } else {
                next_order_book_price
            },
            decimals_a,
            decimals_b,
        ))
        .clamp(MIN_SQRT_PRICE, MAX_SQRT_PRICE);

        order_book_entries.push(OrderBookEntry {
            concentrated_amount: 0,
            concentrated_amount_quote: 0,
            concentrated_total,
            concentrated_total_quote,
            limit_amount: 0,
            limit_amount_quote: 0,
            limit_total,
            limit_total_quote,
            price: next_order_book_price,
            ask_side: !a_to_b,
        });

        let book_entry: &mut OrderBookEntry = order_book_entries.last_mut().unwrap();

        while current_sqrt_price != next_order_book_sqrt_price {
            let next_tick_result = if a_to_b {
                tick_sequence.prev_initialized_tick(current_tick_index)
            } else {
                tick_sequence.next_initialized_tick(current_tick_index)
            };

            let (next_tick, next_tick_index) = match next_tick_result {
                Ok(r) => (r.0, r.1),
                Err(_) => break,
            };

            let next_tick_sqrt_price: u128 = tick_index_to_sqrt_price(next_tick_index).into();

            let next_sqrt_price = if a_to_b {
                next_order_book_sqrt_price.max(next_tick_sqrt_price)
            } else {
                next_order_book_sqrt_price.min(next_tick_sqrt_price)
            };

            let (concentrated_amount_a, concentrated_amount_b) =
                try_get_amount_delta_a_and_b(current_sqrt_price, next_sqrt_price, current_liquidity)?;

            // Liquidity token is B if a_to_b = true, A otherwise.
            let (concentrated_amount, concentrated_amount_quote) = if a_to_b {
                (concentrated_amount_b, concentrated_amount_a)
            } else {
                (concentrated_amount_a, concentrated_amount_b)
            };

            book_entry.concentrated_amount += concentrated_amount;
            book_entry.concentrated_amount_quote = book_entry.concentrated_amount_quote.saturating_add(concentrated_amount_quote);
            book_entry.concentrated_total += concentrated_amount;
            book_entry.concentrated_total_quote = book_entry.concentrated_total_quote.saturating_add(concentrated_amount_quote);
            concentrated_total += concentrated_amount;
            concentrated_total_quote = concentrated_total_quote.saturating_add(concentrated_amount_quote);

            current_sqrt_price = next_sqrt_price;

            // Move to the next tick
            if current_sqrt_price == next_tick_sqrt_price {
                if let Some(tick) = next_tick {
                    let swap_in = tick.open_orders_input + tick.part_filled_orders_remaining_input;
                    let swap_out = if swap_in > 0 {
                        get_limit_order_output_amount(swap_in, !a_to_b, current_sqrt_price, false)?
                    } else {
                        0
                    };

                    book_entry.limit_amount += swap_in;
                    book_entry.limit_total += swap_in;
                    limit_total += swap_in;

                    book_entry.limit_amount_quote += swap_out;
                    book_entry.limit_total_quote += swap_out;
                    limit_total_quote += swap_out;
                }

                current_liquidity = get_next_liquidity(current_liquidity, next_tick, a_to_b);
                current_tick_index = if a_to_b { next_tick_index - 1 } else { next_tick_index }
            }
        }

        current_price = next_order_book_price;
    }
}

const Q64_RESOLUTION: f64 = 18446744073709551616.0;

pub fn try_get_amount_delta_a_and_b(sqrt_price_1_x64: u128, sqrt_price_2_x64: u128, liquidity: u128) -> Result<(u64, u64), CoreError> {
    let sqrt_price_1 = sqrt_price_1_x64 as f64 / Q64_RESOLUTION;
    let sqrt_price_2 = sqrt_price_2_x64 as f64 / Q64_RESOLUTION;

    let b = liquidity as f64 * (sqrt_price_2 - sqrt_price_1).abs();
    let b_u64 = if b < 0.0 {
        0
    } else if b > u64::MAX as f64 {
        u64::MAX
    } else {
        b as u64
    };

    let a = b / (sqrt_price_1 * sqrt_price_2);
    let a_u64 = if a < 0.0 {
        0
    } else if a > u64::MAX as f64 {
        u64::MAX
    } else {
        a as u64
    };

    Ok((a_u64, b_u64))
}

#[cfg(all(test, not(feature = "wasm")))]
mod order_book_tests {
    use crate::{
        get_order_book_side, increase_liquidity_quote_a, increase_liquidity_quote_b, price_to_sqrt_price, sqrt_price_to_tick_index, FusionPoolFacade,
        TickArrayFacade, TickArraySequence, TickFacade, TICK_ARRAY_SIZE,
    };

    fn test_fusion_pool(sqrt_price: u128) -> FusionPoolFacade {
        let tick_current_index = sqrt_price_to_tick_index(sqrt_price.into());
        FusionPoolFacade {
            tick_current_index,
            sqrt_price,
            tick_spacing: 2,
            ..FusionPoolFacade::default()
        }
    }

    fn test_tick_array(start_tick_index: i32, initialized: bool) -> TickArrayFacade {
        TickArrayFacade {
            start_tick_index,
            ticks: [TickFacade {
                initialized,
                ..TickFacade::default()
            }; TICK_ARRAY_SIZE],
        }
    }

    fn test_tick_arrays() -> Vec<TickArrayFacade> {
        vec![
            test_tick_array(-352, false),
            test_tick_array(-176, false),
            test_tick_array(0, false),
            test_tick_array(176, false),
            test_tick_array(352, false),
        ]
    }

    fn test_tick_arrays_for_price_zero_point_five() -> Vec<TickArrayFacade> {
        vec![
            test_tick_array(-7040 - 352, false),
            test_tick_array(-7040 - 176, false),
            test_tick_array(-7040, false),
            test_tick_array(-7040 + 176, false),
            test_tick_array(-7040 + 352, false),
        ]
    }

    fn test_tick_arrays_with_initialized_ticks() -> Vec<TickArrayFacade> {
        vec![
            test_tick_array(-352, true),
            test_tick_array(-176, true),
            test_tick_array(0, true),
            test_tick_array(176, true),
            test_tick_array(352, true),
        ]
    }

    #[test]
    fn test_order_book_ask_side() {
        let fusion_pool = test_fusion_pool(1 << 64);
        let mut tick_arrays = test_tick_arrays();
        let price_step = 0.01;

        let total_token_amount_a = 1_000_000;
        let result = increase_liquidity_quote_a(total_token_amount_a, 0, fusion_pool.sqrt_price.into(), 150, 300, None, None).unwrap();
        assert_eq!(result.token_est_a, total_token_amount_a);
        assert_eq!(result.token_est_b, 0);

        tick_arrays[2].ticks[75].liquidity_net = result.liquidity_delta as i128;
        tick_arrays[2].ticks[75].initialized = true;
        tick_arrays[3].ticks[62].liquidity_net = -(result.liquidity_delta as i128);
        tick_arrays[3].ticks[62].initialized = true;
        tick_arrays[4].ticks[87].open_orders_input = 100_000;
        tick_arrays[4].ticks[87].part_filled_orders_remaining_input = 100_000;
        tick_arrays[4].ticks[87].initialized = true;
        let tick_sequence = TickArraySequence::new(tick_arrays, fusion_pool.tick_spacing).unwrap();

        let order_book = get_order_book_side(&fusion_pool, &tick_sequence, price_step, 8, false, 6, 6).unwrap();

        assert_eq!(order_book.len(), 8);

        let mut price = 1.0;
        let mut concentrated_total = 0;
        let mut limit_total = 0;
        for entry in &order_book {
            price += price_step;
            concentrated_total += entry.concentrated_amount;
            limit_total += entry.limit_amount;
            assert_eq!(entry.price, price);
            assert_eq!(entry.concentrated_total, concentrated_total);
            assert_eq!(entry.limit_total, limit_total);
            assert!(entry.ask_side);
        }

        assert!(concentrated_total.abs_diff(total_token_amount_a) < 10);

        // Liquidity is in token A
        assert_eq!(order_book[0].concentrated_amount, 0);
        assert_eq!(order_book[1].concentrated_amount, 321057);
        assert_eq!(order_book[2].concentrated_amount, 649734);
        assert_eq!(order_book[3].concentrated_amount, 29208);
        assert_eq!(order_book[4].concentrated_amount, 0);
        assert_eq!(order_book[5].concentrated_amount, 0);
        assert_eq!(order_book[6].concentrated_amount, 0);
        assert_eq!(order_book[7].concentrated_amount, 0);

        assert_eq!(order_book[0].concentrated_amount_quote, 0);
        assert_eq!(order_book[1].concentrated_amount_quote, 326693);
        assert_eq!(order_book[2].concentrated_amount_quote, 665969);
        assert_eq!(order_book[3].concentrated_amount_quote, 30090);
        assert_eq!(order_book[4].concentrated_amount_quote, 0);
        assert_eq!(order_book[5].concentrated_amount_quote, 0);
        assert_eq!(order_book[6].concentrated_amount_quote, 0);
        assert_eq!(order_book[7].concentrated_amount_quote, 0);

        assert_eq!(order_book[0].limit_amount, 0);
        assert_eq!(order_book[1].limit_amount, 0);
        assert_eq!(order_book[2].limit_amount, 0);
        assert_eq!(order_book[3].limit_amount, 0);
        assert_eq!(order_book[4].limit_amount, 0);
        assert_eq!(order_book[5].limit_amount, 200000);
        assert_eq!(order_book[5].limit_amount_quote, 210801);
        assert_eq!(order_book[6].limit_amount, 0);
        assert_eq!(order_book[6].limit_amount_quote, 0);
        assert_eq!(order_book[7].limit_amount, 0);
        assert_eq!(order_book[7].limit_amount_quote, 0);
    }

    #[test]
    fn test_order_book_ask_side_with_all_initialized_ticks() {
        let fusion_pool = test_fusion_pool(1 << 64);
        let mut tick_arrays = test_tick_arrays_with_initialized_ticks();
        let price_step = 0.01;

        let total_token_amount_a = 1_000_000;
        let result = increase_liquidity_quote_a(total_token_amount_a, 0, fusion_pool.sqrt_price.into(), 150, 300, None, None).unwrap();
        assert_eq!(result.token_est_a, total_token_amount_a);
        assert_eq!(result.token_est_b, 0);

        tick_arrays[2].ticks[75].liquidity_net = result.liquidity_delta as i128;
        tick_arrays[3].ticks[62].liquidity_net = -(result.liquidity_delta as i128);
        tick_arrays[4].ticks[87].open_orders_input = 100_000;
        tick_arrays[4].ticks[87].part_filled_orders_remaining_input = 100_000;
        let tick_sequence = TickArraySequence::new(tick_arrays, fusion_pool.tick_spacing).unwrap();

        let order_book = get_order_book_side(&fusion_pool, &tick_sequence, price_step, 8, false, 6, 6).unwrap();

        assert_eq!(order_book.len(), 8);

        let mut price = 1.0;
        let mut concentrated_total = 0;
        let mut limit_total = 0;
        for entry in &order_book {
            price += price_step;
            concentrated_total += entry.concentrated_amount;
            limit_total += entry.limit_amount;
            assert_eq!(entry.price, price);
            assert_eq!(entry.concentrated_total, concentrated_total);
            assert_eq!(entry.limit_total, limit_total);
            assert!(entry.ask_side);
        }

        assert!(concentrated_total.abs_diff(total_token_amount_a) < 100);

        // Liquidity is in token A
        assert_eq!(order_book[0].concentrated_amount, 0);
        assert_eq!(order_book[1].concentrated_amount, 321046);
        assert_eq!(order_book[2].concentrated_amount, 649708);
        assert_eq!(order_book[3].concentrated_amount, 29207);
        assert_eq!(order_book[4].concentrated_amount, 0);
        assert_eq!(order_book[5].concentrated_amount, 0);
        assert_eq!(order_book[6].concentrated_amount, 0);
        assert_eq!(order_book[7].concentrated_amount, 0);

        assert_eq!(order_book[0].concentrated_amount_quote, 0);
        assert_eq!(order_book[1].concentrated_amount_quote, 326681);
        assert_eq!(order_book[2].concentrated_amount_quote, 665945);
        assert_eq!(order_book[3].concentrated_amount_quote, 30089);
        assert_eq!(order_book[4].concentrated_amount_quote, 0);
        assert_eq!(order_book[5].concentrated_amount_quote, 0);
        assert_eq!(order_book[6].concentrated_amount_quote, 0);
        assert_eq!(order_book[7].concentrated_amount_quote, 0);

        assert_eq!(order_book[0].limit_amount, 0);
        assert_eq!(order_book[1].limit_amount, 0);
        assert_eq!(order_book[2].limit_amount, 0);
        assert_eq!(order_book[3].limit_amount, 0);
        assert_eq!(order_book[4].limit_amount, 0);
        assert_eq!(order_book[5].limit_amount, 200000);
        assert_eq!(order_book[5].limit_amount_quote, 210801);
        assert_eq!(order_book[6].limit_amount, 0);
        assert_eq!(order_book[6].limit_amount_quote, 0);
        assert_eq!(order_book[7].limit_amount, 0);
        assert_eq!(order_book[7].limit_amount_quote, 0);
    }

    #[test]
    fn test_order_book_bid_side() {
        let fusion_pool = test_fusion_pool(1 << 64);
        let mut tick_arrays = test_tick_arrays();
        let price_step = -0.01;

        let total_token_amount_b = 1_000_000;
        let result = increase_liquidity_quote_b(total_token_amount_b, 0, fusion_pool.sqrt_price.into(), -300, -150, None, None).unwrap();
        assert_eq!(result.token_est_a, 0);
        assert_eq!(result.token_est_b, total_token_amount_b);

        tick_arrays[0].ticks[0].open_orders_input = 100_000;
        tick_arrays[0].ticks[0].part_filled_orders_remaining_input = 100_000;
        tick_arrays[0].ticks[0].initialized = true;
        tick_arrays[0].ticks[26].liquidity_net = result.liquidity_delta as i128;
        tick_arrays[0].ticks[26].initialized = true;
        tick_arrays[1].ticks[13].liquidity_net = -(result.liquidity_delta as i128);
        tick_arrays[1].ticks[13].initialized = true;
        let tick_sequence = Box::new(TickArraySequence::new(tick_arrays, fusion_pool.tick_spacing).unwrap());

        let order_book = get_order_book_side(&fusion_pool, &tick_sequence, price_step, 7, false, 6, 6).unwrap();

        assert_eq!(order_book.len(), 7);

        let mut price = 1.0;
        let mut concentrated_total = 0;
        let mut limit_total = 0;
        for entry in &order_book {
            price += price_step;
            concentrated_total += entry.concentrated_amount;
            limit_total += entry.limit_amount;
            assert_eq!(entry.price, price);
            assert_eq!(entry.concentrated_total, concentrated_total);
            assert_eq!(entry.limit_total, limit_total);
            assert!(!entry.ask_side);
        }

        assert!(concentrated_total.abs_diff(total_token_amount_b) < 10);

        // Liquidity is in token B
        assert_eq!(order_book[0].concentrated_amount, 0);
        assert_eq!(order_book[1].concentrated_amount, 347764);
        assert_eq!(order_book[2].concentrated_amount, 652235);
        assert_eq!(order_book[3].concentrated_amount, 0);

        assert_eq!(order_book[0].concentrated_amount_quote, 0);
        assert_eq!(order_book[1].concentrated_amount_quote, 353939);
        assert_eq!(order_book[2].concentrated_amount_quote, 668814);
        assert_eq!(order_book[3].concentrated_amount_quote, 0);

        assert_eq!(order_book[0].limit_amount_quote, 0);
        assert_eq!(order_book[1].limit_amount_quote, 0);
        assert_eq!(order_book[2].limit_amount_quote, 0);
        assert_eq!(order_book[3].limit_amount, 200000);
        assert_eq!(order_book[3].limit_amount_quote, 207165);
    }

    #[test]
    fn test_order_book_bid_side_with_all_initialized_ticks() {
        let fusion_pool = test_fusion_pool(1 << 64);
        let mut tick_arrays = test_tick_arrays_with_initialized_ticks();
        let price_step = -0.01;

        let total_token_amount_b = 1_000_000;
        let result = increase_liquidity_quote_b(total_token_amount_b, 0, fusion_pool.sqrt_price.into(), -300, -150, None, None).unwrap();
        assert_eq!(result.token_est_a, 0);
        assert_eq!(result.token_est_b, total_token_amount_b);

        tick_arrays[0].ticks[0].open_orders_input = 100_000;
        tick_arrays[0].ticks[0].part_filled_orders_remaining_input = 100_000;
        tick_arrays[0].ticks[26].liquidity_net = result.liquidity_delta as i128;
        tick_arrays[1].ticks[13].liquidity_net = -(result.liquidity_delta as i128);
        let tick_sequence = Box::new(TickArraySequence::new(tick_arrays, fusion_pool.tick_spacing).unwrap());

        let order_book = get_order_book_side(&fusion_pool, &tick_sequence, price_step, 4, false, 6, 6).unwrap();

        assert_eq!(order_book.len(), 4);

        let mut price = 1.0;
        let mut concentrated_total = 0;
        let mut limit_total = 0;
        for entry in &order_book {
            price += price_step;
            concentrated_total += entry.concentrated_amount;
            limit_total += entry.limit_amount;
            assert_eq!(entry.price, price);
            assert_eq!(entry.concentrated_total, concentrated_total);
            assert_eq!(entry.limit_total, limit_total);
            assert!(!entry.ask_side);
        }

        assert!(concentrated_total.abs_diff(total_token_amount_b) < 100);

        // Liquidity is in token B
        assert_eq!(order_book[0].concentrated_amount, 0);
        assert_eq!(order_book[1].concentrated_amount, 347752);
        assert_eq!(order_book[2].concentrated_amount, 652209);
        assert_eq!(order_book[3].concentrated_amount, 0);

        assert_eq!(order_book[0].concentrated_amount, 0);
        assert_eq!(order_book[1].concentrated_amount_quote, 353926);
        assert_eq!(order_book[2].concentrated_amount_quote, 668790);
        assert_eq!(order_book[3].concentrated_amount_quote, 0);

        assert_eq!(order_book[0].limit_amount, 0);
        assert_eq!(order_book[1].limit_amount, 0);
        assert_eq!(order_book[2].limit_amount, 0);
        assert_eq!(order_book[3].limit_amount, 200000);
        assert_eq!(order_book[3].limit_amount_quote, 207165);
    }

    #[test]
    fn test_order_book_ask_side_inverted_price() {
        let fusion_pool = test_fusion_pool(price_to_sqrt_price(0.5, 6, 6));
        let mut tick_arrays = test_tick_arrays_for_price_zero_point_five();
        let price_step = -0.01;

        let total_token_amount_a = 1_000_000;
        let result =
            increase_liquidity_quote_a(total_token_amount_a, 0, fusion_pool.sqrt_price.into(), -7040 + 150, -7040 + 300, None, None).unwrap();
        assert_eq!(result.token_est_a, total_token_amount_a);
        assert_eq!(result.token_est_b, 0);

        tick_arrays[2].ticks[75].liquidity_net = result.liquidity_delta as i128;
        tick_arrays[2].ticks[75].initialized = true;
        tick_arrays[3].ticks[62].liquidity_net = -(result.liquidity_delta as i128);
        tick_arrays[3].ticks[62].initialized = true;
        tick_arrays[4].ticks[87].open_orders_input = 100_000;
        tick_arrays[4].ticks[87].part_filled_orders_remaining_input = 100_000;
        tick_arrays[4].ticks[87].initialized = true;
        let tick_sequence = TickArraySequence::new(tick_arrays, fusion_pool.tick_spacing).unwrap();

        let order_book = get_order_book_side(&fusion_pool, &tick_sequence, price_step, 10, true, 6, 6).unwrap();

        assert_eq!(order_book.len(), 10);

        let mut price = 1.0 / 0.5;
        let mut concentrated_total = 0;
        let mut limit_total = 0;
        for entry in &order_book {
            price += price_step;
            concentrated_total += entry.concentrated_amount;
            limit_total += entry.limit_amount;
            assert!((entry.price - price).abs() < 0.000000000001);
            assert_eq!(entry.concentrated_total, concentrated_total);
            assert_eq!(entry.limit_total, limit_total);
            assert!(entry.ask_side);
        }

        assert!(concentrated_total.abs_diff(total_token_amount_a) < 10);

        assert_eq!(order_book[0].price, 1.99);
        assert_eq!(order_book[1].price, 1.98);
        assert_eq!(order_book[2].price, 1.97);

        // Liquidity is in token A
        assert_eq!(order_book[0].concentrated_amount, 55593);
        assert_eq!(order_book[1].concentrated_amount, 336566);
        assert_eq!(order_book[2].concentrated_amount, 337417);
        assert_eq!(order_book[3].concentrated_amount, 270422);
        assert_eq!(order_book[4].concentrated_amount, 0);
        assert_eq!(order_book[5].concentrated_amount, 0);
        assert_eq!(order_book[6].concentrated_amount, 0);
        assert_eq!(order_book[7].concentrated_amount, 0);
        assert_eq!(order_book[8].concentrated_amount, 0);
        assert_eq!(order_book[9].concentrated_amount, 0);

        assert_eq!(order_book[0].limit_amount, 0);
        assert_eq!(order_book[7].limit_amount, 0);
        assert_eq!(order_book[8].limit_amount, 200000);
        assert_eq!(order_book[8].limit_amount_quote, 104266);
        assert_eq!(order_book[9].limit_amount, 0);
        assert_eq!(order_book[9].limit_amount_quote, 0);
    }

    #[test]
    fn test_order_book_bid_side_inverted_price() {
        let fusion_pool = test_fusion_pool(price_to_sqrt_price(0.4999, 6, 6));
        let mut tick_arrays = test_tick_arrays_for_price_zero_point_five();
        let price_step = 0.01;

        let total_token_amount_b = 1_000_000;
        let result =
            increase_liquidity_quote_b(total_token_amount_b, 0, fusion_pool.sqrt_price.into(), -7040 - 300, -7040 - 150, None, None).unwrap();
        assert_eq!(result.token_est_a, 0);
        assert_eq!(result.token_est_b, total_token_amount_b);

        tick_arrays[0].ticks[0].open_orders_input = 100_000;
        tick_arrays[0].ticks[0].part_filled_orders_remaining_input = 100_000;
        tick_arrays[0].ticks[0].initialized = true;
        tick_arrays[0].ticks[26].liquidity_net = result.liquidity_delta as i128;
        tick_arrays[0].ticks[26].initialized = true;
        tick_arrays[1].ticks[13].liquidity_net = -(result.liquidity_delta as i128);
        tick_arrays[1].ticks[13].initialized = true;
        let tick_sequence = Box::new(TickArraySequence::new(tick_arrays, fusion_pool.tick_spacing).unwrap());

        let order_book = get_order_book_side(&fusion_pool, &tick_sequence, price_step, 11, true, 6, 6).unwrap();

        assert_eq!(order_book.len(), 11);

        let mut price = 1.0 / 0.5;
        let mut concentrated_total = 0;
        let mut limit_total = 0;
        for entry in &order_book {
            price += price_step;
            concentrated_total += entry.concentrated_amount;
            limit_total += entry.limit_amount;
            assert!((entry.price - price).abs() < 0.000000000001);
            assert_eq!(entry.concentrated_total, concentrated_total);
            assert_eq!(entry.limit_total, limit_total);
            assert!(!entry.ask_side);
        }

        assert!(concentrated_total.abs_diff(total_token_amount_b) < 10);

        assert_eq!(order_book[0].price, 2.01);
        assert_eq!(order_book[1].price, 2.0199999999999996);
        assert_eq!(order_book[2].price, 2.0299999999999994);

        // Liquidity is in token B
        assert_eq!(order_book[0].concentrated_amount, 0);
        assert_eq!(order_book[1].concentrated_amount, 0);
        assert_eq!(order_book[2].concentrated_amount, 0);
        assert_eq!(order_book[3].concentrated_amount, 0);
        assert_eq!(order_book[4].concentrated_amount, 0);
        assert_eq!(order_book[5].concentrated_amount, 250177);
        assert_eq!(order_book[6].concentrated_amount, 323072);
        assert_eq!(order_book[7].concentrated_amount, 320740);
        assert_eq!(order_book[8].concentrated_amount, 106009);
        assert_eq!(order_book[9].concentrated_amount, 0);
        assert_eq!(order_book[10].concentrated_amount, 0);

        assert_eq!(order_book[0].limit_amount, 0);
        assert_eq!(order_book[7].limit_amount, 0);
        assert_eq!(order_book[8].limit_amount, 0);
        assert_eq!(order_book[9].limit_amount, 200000);
        assert_eq!(order_book[9].limit_amount_quote, 418836);
        assert_eq!(order_book[10].limit_amount, 0);
        assert_eq!(order_book[10].limit_amount_quote, 0);
    }

    #[test]
    fn test_order_book_one_entry_ask_side() {
        let fusion_pool = test_fusion_pool(1 << 64);
        let mut tick_arrays = test_tick_arrays();
        let price_step = 100000.0;

        let total_token_amount_a = 1_000_000;
        let result = increase_liquidity_quote_a(total_token_amount_a, 0, fusion_pool.sqrt_price.into(), 150, 300, None, None).unwrap();
        assert_eq!(result.token_est_a, total_token_amount_a);
        assert_eq!(result.token_est_b, 0);

        tick_arrays[2].ticks[75].liquidity_net = result.liquidity_delta as i128;
        tick_arrays[2].ticks[75].initialized = true;
        tick_arrays[3].ticks[62].liquidity_net = -(result.liquidity_delta as i128);
        tick_arrays[3].ticks[62].initialized = true;
        let tick_sequence = TickArraySequence::new(tick_arrays, fusion_pool.tick_spacing).unwrap();

        let order_book = get_order_book_side(&fusion_pool, &tick_sequence, price_step, 1, false, 6, 6).unwrap();

        assert_eq!(order_book.len(), 1);
        assert!(order_book[0].ask_side);
        assert_eq!(order_book[0].concentrated_amount, 999999);
        assert_eq!(order_book[0].concentrated_total, 999999);
    }

    #[test]
    fn test_order_book_one_entry_bid_side() {
        let fusion_pool = test_fusion_pool(1 << 64);
        let mut tick_arrays = test_tick_arrays();
        let price_step = -100000.0;

        let total_token_amount_b = 1_000_000;
        let result = increase_liquidity_quote_b(total_token_amount_b, 0, fusion_pool.sqrt_price.into(), -300, -150, None, None).unwrap();
        assert_eq!(result.token_est_a, 0);
        assert_eq!(result.token_est_b, total_token_amount_b);

        tick_arrays[0].ticks[26].liquidity_net = result.liquidity_delta as i128;
        tick_arrays[0].ticks[26].initialized = true;
        tick_arrays[1].ticks[13].liquidity_net = -(result.liquidity_delta as i128);
        tick_arrays[1].ticks[13].initialized = true;
        let tick_sequence = TickArraySequence::new(tick_arrays, fusion_pool.tick_spacing).unwrap();

        let order_book = get_order_book_side(&fusion_pool, &tick_sequence, price_step, 1, false, 6, 6).unwrap();

        assert_eq!(order_book.len(), 1);
        assert!(!order_book[0].ask_side);
        assert_eq!(order_book[0].concentrated_amount, 999999);
        assert_eq!(order_book[0].concentrated_total, 999999);
    }

    #[test]
    fn test_order_book_ask_side_inverted_price_at_tick_boundary() {
        let fusion_pool = FusionPoolFacade {
            tick_current_index: 60967,
            sqrt_price: 388827372296071623697,
            tick_spacing: 8,
            ..FusionPoolFacade::default()
        };
        let mut tick_arrays = vec![
            test_tick_array(60544 - 88 * 8 * 2, false),
            test_tick_array(60544 - 88 * 8, false),
            test_tick_array(60544, false),
            test_tick_array(60544 + 88 * 8, false),
            test_tick_array(60544 + 88 * 8 * 2, false),
        ];
        let price_step = -0.001;

        tick_arrays[2].ticks[53].initialized = true;
        tick_arrays[2].ticks[53].part_filled_orders_input = 35000000000;
        tick_arrays[2].ticks[53].part_filled_orders_remaining_input = 32000000000;

        tick_arrays[2].ticks[54].initialized = true;
        tick_arrays[2].ticks[54].part_filled_orders_remaining_input = 15000000000;
        let tick_sequence = TickArraySequence::new(tick_arrays, fusion_pool.tick_spacing).unwrap();

        let order_book = get_order_book_side(&fusion_pool, &tick_sequence, price_step, 100, true, 6, 9).unwrap();

        assert_eq!(order_book.len(), 100);

        assert_eq!(order_book[0].price, 2.25);
        assert_eq!(order_book[1].price, 2.249);
        assert_eq!(order_book[2].price, 2.248);

        assert_eq!(order_book[0].limit_amount, 32000000000);
        assert_eq!(order_book[1].limit_amount, 0);
        assert_eq!(order_book[2].limit_amount, 15000000000);
        assert_eq!(order_book[3].limit_amount, 0);
    }

    /*
    fn test_large_tick_arrays_with_initialized_ticks() -> Vec<TickArrayFacade> {
        let mut tick_arrays: Vec<TickArrayFacade> = vec![];

        let start_index = get_tick_array_start_tick_index(-50000, 2);
        let end_index = get_tick_array_start_tick_index(50000, 2);
        for i in (start_index..end_index).step_by(176) {
            tick_arrays.push(test_tick_array(i, true))
        }

        tick_arrays
    }

    // The test is only used to measure the performance.
    #[test]
    fn test_order_book_ask_side_with_all_initialized_ticks_slow() {
        let fusion_pool = test_fusion_pool(1 << 64);
        let mut tick_arrays = test_large_tick_arrays_with_initialized_ticks();
        let price_step = 1000.0;

        let total_token_amount_a = 1_000_000;
        let result = increase_liquidity_quote_a(total_token_amount_a, 0, fusion_pool.sqrt_price.into(), 150, 300, None, None).unwrap();
        assert_eq!(result.token_est_a, total_token_amount_a);
        assert_eq!(result.token_est_b, 0);

        tick_arrays[286].ticks[75].liquidity_net = result.liquidity_delta as i128;
        tick_arrays[287].ticks[62].liquidity_net = -(result.liquidity_delta as i128);
        tick_arrays[288].ticks[87].open_orders_input = 100_000;
        tick_arrays[288].ticks[87].part_filled_orders_remaining_input = 100_000;
        let tick_sequence = TickArraySequenceVec::new(tick_arrays, fusion_pool.tick_spacing).unwrap();

        let instant = Instant::now();

        let order_book = get_order_book_side(&fusion_pool, &tick_sequence, price_step, false, 6, 6, 100).unwrap();

        println!("{} ms", instant.elapsed().as_millis());

        assert_eq!(order_book.len(), 1);

        // Liquidity is in token A
        assert_eq!(order_book[0].concentrated_amount, 991201);
        assert_eq!(order_book[0].concentrated_amount_quote, 1031755);
        assert_eq!(order_book[0].limit_amount, 200000);
        //assert_eq!(instant.elapsed().as_millis(), 1111);
    }
     */
}
