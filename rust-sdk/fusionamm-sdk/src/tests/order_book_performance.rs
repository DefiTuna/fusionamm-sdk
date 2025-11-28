use fusionamm_client::{FusionPool, TickArray};
use fusionamm_core::{
    get_order_book_side, get_tick_array_start_tick_index, invert_sqrt_price, price_to_sqrt_price, price_to_tick_index, sqrt_price_to_price,
    sqrt_price_to_tick_index, tick_index_to_price, FusionPoolFacade, OrderBookEntry, TickArrayFacade, TickArraySequence, TickFacade, MAX_TICK_INDEX,
    MIN_TICK_INDEX, TICK_ARRAY_SIZE,
};
use solana_pubkey::Pubkey;
use std::collections::HashMap;
use std::str::FromStr;

const DEFAULT_ORDER_BOOK_ENTRIES: u32 = 12;
const TICK_EDGE_OFFSET: i32 = 10000;

#[derive(serde::Serialize, serde::Deserialize)]
struct Pool {
    mint_a_dec: u8,
    mint_b_dec: u8,
    pool: Vec<u8>,
    tick_arrays: HashMap<String, Vec<u8>>,
}

#[test]
fn test_order_book_performance() {
    let file = std::fs::File::open("src/tests/mocks/fusion_pools.json").unwrap();

    // Deserialize JSON → HashMap<String, Pool>
    let raw_pools: HashMap<String, Pool> = serde_json::from_reader(file).unwrap();

    let mut pools = HashMap::new();
    let mut tick_arrays = HashMap::new();
    let mut decimals = HashMap::new();

    for (pool_address, pool) in raw_pools {
        let pool_address = Pubkey::from_str(&pool_address).unwrap();

        decimals.insert(pool_address, (pool.mint_a_dec, pool.mint_b_dec));

        let mut pool_tick_arrays = HashMap::new();

        for (tick_array_address, tick_array) in pool.tick_arrays {
            let tick_array_address = Pubkey::from_str(&tick_array_address).unwrap();
            let tick_array = TickArray::from_bytes(&tick_array).unwrap();

            pool_tick_arrays.insert(tick_array_address, tick_array);
        }

        tick_arrays.insert(pool_address, pool_tick_arrays);

        let pool = FusionPool::from_bytes(&pool.pool).unwrap();

        pools.insert(pool_address, pool);
    }

    let mut tick_arrays_map_vec = HashMap::new();

    for (tick_array_address, tick_arrays) in tick_arrays {
        let mut vec = tick_arrays.into_values().collect::<Vec<_>>();
        vec.sort_by_key(|k| k.start_tick_index);

        tick_arrays_map_vec.insert(tick_array_address, vec);
    }

    println!("pools: {:?}", pools.len());

    /*
    let guard = pprof::ProfilerGuardBuilder::default()
        .frequency(10000)
        .blocklist(&["libc", "libgcc", "pthread", "vdso"])
        .build()
        .unwrap();
    */
    let start = std::time::Instant::now();

    for (pool_address, pool) in pools.iter() {
        calc_order_book(pool, tick_arrays_map_vec.get(pool_address).unwrap(), *decimals.get(pool_address).unwrap());
    }

    println!("Done in {:?}", start.elapsed());

    /*
    if let Ok(report) = guard.report().build() {
        let timestamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs();

        let filename = format!("flamegraph_{}.svg", timestamp);
        let file = std::fs::File::create(filename.clone()).unwrap();
        report.flamegraph(file).unwrap();
        eprintln!("{} saved!", filename);
    }
    */
}

fn calc_order_book(pool: &FusionPool, tick_arrays: &Vec<TickArray>, decimals: (u8, u8)) {
    let sqrt_price = pool.sqrt_price;

    let pool_price = sqrt_price_to_price(sqrt_price, decimals.0, decimals.1);
    if pool_price < 0.0 {
        panic!("Pool price should be greater than zero");
    }
    let pool_price_inverted = 1.0 / pool_price;

    let price_steps = get_order_book_price_steps_f64(pool_price);
    let price_steps_inverted = get_order_book_price_steps_f64(pool_price_inverted);

    let tick_refs: Vec<&TickArray> = tick_arrays.iter().collect();

    let mut order_books = Vec::with_capacity(price_steps.len());
    let mut order_books_inverted = Vec::with_capacity(price_steps_inverted.len());

    for step in price_steps {
        // println!("Calculating pool {} price step {} order book", pool_address, step);
        order_books.push(OrderBook::new(step, false, DEFAULT_ORDER_BOOK_ENTRIES, pool, decimals, &tick_refs));
    }

    for step in price_steps_inverted {
        // println!("Calculating pool {} inverted price step {} order book", pool_address, step);
        order_books_inverted.push(OrderBook::new(step, false, DEFAULT_ORDER_BOOK_ENTRIES, pool, decimals, &tick_refs));
    }
}

#[allow(dead_code)]
struct OrderBook {
    pub price_step: f64,
    pub bids: Vec<OrderBookEntry>,
    pub asks: Vec<OrderBookEntry>,
}

impl OrderBook {
    pub fn new(
        price_step: f64,
        inverted: bool,
        entries: u32,
        pool: &FusionPool,
        (decimals_a, decimals_b): (u8, u8),
        tick_arrays: &[&TickArray],
    ) -> Result<Self, fusionamm_core::CoreError> {
        let fusion_pool_facade = FusionPoolFacade {
            tick_spacing: pool.tick_spacing,
            fee_rate: pool.fee_rate,
            protocol_fee_rate: pool.protocol_fee_rate,
            liquidity: pool.liquidity,
            sqrt_price: pool.sqrt_price,
            tick_current_index: pool.tick_current_index,
            fee_growth_global_a: pool.fee_growth_global_a,
            fee_growth_global_b: pool.fee_growth_global_b,
            orders_total_amount_a: pool.orders_total_amount_a,
            orders_total_amount_b: pool.orders_total_amount_b,
            orders_filled_amount_a: pool.orders_filled_amount_a,
            orders_filled_amount_b: pool.orders_filled_amount_b,
            olp_fee_owed_a: pool.olp_fee_owed_a,
            olp_fee_owed_b: pool.olp_fee_owed_b,
        };
        let price_shift = price_step * entries as f64;
        let pool_price = if inverted {
            sqrt_price_to_price(invert_sqrt_price(fusion_pool_facade.sqrt_price), decimals_b, decimals_a)
        } else {
            sqrt_price_to_price(fusion_pool_facade.sqrt_price, decimals_a, decimals_b)
        };
        let min_price = tick_index_to_price(MIN_TICK_INDEX + TICK_EDGE_OFFSET, decimals_a, decimals_b);
        let max_price = tick_index_to_price(MAX_TICK_INDEX - TICK_EDGE_OFFSET, decimals_a, decimals_b);
        //let min_decimal_price = sqrt_price_to_price(fusionamm_core::MIN_SQRT_PRICE, decimals_a, decimals_b);

        let lower_price = min_price.max(pool_price - price_shift);
        let upper_price = max_price.min(pool_price + price_shift);
        let lower_tick_index = if inverted {
            let sqrt_price = invert_sqrt_price(price_to_sqrt_price(upper_price, decimals_b, decimals_a));
            sqrt_price_to_tick_index(sqrt_price)
        } else {
            price_to_tick_index(lower_price, decimals_a, decimals_b)
        };
        let upper_tick_index = if inverted {
            let sqrt_price = invert_sqrt_price(price_to_sqrt_price(lower_price, decimals_b, decimals_a));
            sqrt_price_to_tick_index(sqrt_price)
        } else {
            price_to_tick_index(upper_price, decimals_a, decimals_b)
        };
        let lower_tick_array_start_index = get_tick_array_start_tick_index(lower_tick_index, fusion_pool_facade.tick_spacing);
        let upper_tick_array_start_index = get_tick_array_start_tick_index(upper_tick_index, fusion_pool_facade.tick_spacing);
        let tick_arrays_map: HashMap<i32, &TickArray> = tick_arrays.iter().map(|tick_array| (tick_array.start_tick_index, *tick_array)).collect();
        let tick_arrays_count =
            (upper_tick_array_start_index - lower_tick_array_start_index) / (TICK_ARRAY_SIZE as i32 * fusion_pool_facade.tick_spacing as i32);
        let mut matching_tick_arrays: Vec<TickArrayFacade> = Vec::new();

        for i in 0..=tick_arrays_count {
            let shift = i * TICK_ARRAY_SIZE as i32 * fusion_pool_facade.tick_spacing as i32;
            let tick_array_start_index = lower_tick_array_start_index + shift;
            let tick_array = tick_arrays_map.get(&tick_array_start_index);

            if let Some(tick_array) = tick_array {
                matching_tick_arrays.push((*tick_array).clone().into());
            } else {
                matching_tick_arrays.push(TickArrayFacade {
                    start_tick_index: tick_array_start_index,
                    ticks: [TickFacade::default(); 88],
                });
            }
        }

        let tick_array_sequence = TickArraySequence {
            tick_arrays: matching_tick_arrays,
            tick_spacing: fusion_pool_facade.tick_spacing,
        };

        let asks = get_order_book_side(&fusion_pool_facade, &tick_array_sequence, price_step, entries, inverted, decimals_a, decimals_b)?;
        let bids = get_order_book_side(&fusion_pool_facade, &tick_array_sequence, price_step * -1.0, entries, inverted, decimals_a, decimals_b)?;

        Ok(Self { price_step, bids, asks })
    }
}

pub fn get_order_book_price_steps_f64(price: f64) -> Vec<f64> {
    if price <= 0.0 {
        panic!("price must be greater than 0");
    }

    let min_price_step = 1e-13;

    // largest power of 10 smaller than price
    let max_power = price.log10().floor() as i32;

    let mut steps = Vec::new();
    for i in 0..5 {
        let power = max_power - i;

        // Equivalent to BigDecimal(10^power)
        let step = 10f64.powi(power);

        let triple_step = step * 3.0;

        // i == 4 → include 2× and 5× variants
        if i == 4 {
            let quint = step * 5.0;
            let double = step * 2.0;

            if quint >= min_price_step {
                steps.push(quint);
            }
            if double >= min_price_step {
                steps.push(double);
            }
        }

        // skip too small steps
        if step < min_price_step {
            continue;
        }

        // price smaller than 3× step → skip
        if price < triple_step {
            continue;
        }

        steps.push(step);
    }

    steps
}
