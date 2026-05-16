use crate::{MaybeTick, TickArray};
use fusionamm_core::{TickArrayFacade, TickFacade};

impl TickArray {
    pub const MIN_LEN: usize = 132; // 8+4+32+88
    pub const MAX_LEN: usize = 9988; // 8+4+32+88*113
}

impl From<TickArray> for TickArrayFacade {
    fn from(val: TickArray) -> Self {
        TickArrayFacade {
            start_tick_index: val.start_tick_index,
            ticks: val.ticks.map(|tick| tick.into()),
        }
    }
}

impl From<MaybeTick> for TickFacade {
    fn from(val: MaybeTick) -> Self {
        match val {
            MaybeTick::Uninitialized => TickFacade {
                initialized: false,
                liquidity_net: 0,
                liquidity_gross: 0,
                fee_growth_outside_a: 0,
                fee_growth_outside_b: 0,
                age: 0,
                open_orders_input: 0,
                part_filled_orders_input: 0,
                part_filled_orders_remaining_input: 0,
                fulfilled_a_to_b_orders_input: 0,
                fulfilled_b_to_a_orders_input: 0,
            },
            MaybeTick::Initialized(tick) => TickFacade {
                initialized: true,
                liquidity_net: tick.liquidity_net,
                liquidity_gross: tick.liquidity_gross,
                fee_growth_outside_a: tick.fee_growth_outside_a,
                fee_growth_outside_b: tick.fee_growth_outside_b,
                age: tick.age,
                open_orders_input: tick.open_orders_input,
                part_filled_orders_input: tick.part_filled_orders_input,
                part_filled_orders_remaining_input: tick.part_filled_orders_remaining_input,
                fulfilled_a_to_b_orders_input: tick.fulfilled_a_to_b_orders_input,
                fulfilled_b_to_a_orders_input: tick.fulfilled_b_to_a_orders_input,
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{MaybeTick, TickData, TICK_ARRAY_DISCRIMINATOR};
    use solana_program::pubkey::Pubkey;

    #[test]
    fn test_tick_array_to_facade() {
        let mut ticks: [MaybeTick; 88] = std::array::from_fn(|_| MaybeTick::Uninitialized);

        ticks[1] = MaybeTick::Initialized(TickData {
            liquidity_net: 1,
            liquidity_gross: 2,
            fee_growth_outside_a: 3,
            fee_growth_outside_b: 4,
            age: 5,
            open_orders_input: 6,
            part_filled_orders_input: 7,
            part_filled_orders_remaining_input: 8,
            fulfilled_a_to_b_orders_input: 9,
            fulfilled_b_to_a_orders_input: 10,
        });

        let tick_array = TickArray {
            discriminator: TICK_ARRAY_DISCRIMINATOR,
            start_tick_index: 176,
            fusion_pool: Pubkey::new_unique(),
            ticks,
        };

        let facade: TickArrayFacade = tick_array.into();

        assert_eq!(facade.start_tick_index, 176);
        assert!(facade.ticks[1].initialized);
        assert_eq!(facade.ticks[1].liquidity_net, 1);
        assert_eq!(facade.ticks[1].liquidity_gross, 2);
        assert_eq!(facade.ticks[1].fee_growth_outside_a, 3);
        assert_eq!(facade.ticks[1].fee_growth_outside_b, 4);
        assert_eq!(facade.ticks[1].age, 5);
        assert_eq!(facade.ticks[1].open_orders_input, 6);
        assert_eq!(facade.ticks[1].part_filled_orders_input, 7);
        assert_eq!(facade.ticks[1].part_filled_orders_remaining_input, 8);
        assert_eq!(facade.ticks[1].fulfilled_a_to_b_orders_input, 9);
        assert_eq!(facade.ticks[1].fulfilled_b_to_a_orders_input, 10);
    }
}
