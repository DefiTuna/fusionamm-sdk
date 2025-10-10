//
// Copyright (c) Cryptic Dot
//
// Modification based on Orca Whirlpools (https://github.com/orca-so/whirlpools),
// originally licensed under the Apache License, Version 2.0, prior to February 26, 2025.
//
// Modifications licensed under FusionAMM SDK Source-Available License v1.0
// See the LICENSE file in the project root for license information.
//

use fusionamm_core::FusionPoolFacade;

use crate::FusionPool;

impl From<FusionPool> for FusionPoolFacade {
    fn from(val: FusionPool) -> Self {
        FusionPoolFacade {
            tick_spacing: val.tick_spacing,
            fee_rate: val.fee_rate,
            protocol_fee_rate: val.protocol_fee_rate,
            liquidity: val.liquidity,
            sqrt_price: val.sqrt_price,
            tick_current_index: val.tick_current_index,
            fee_growth_global_a: val.fee_growth_global_a,
            fee_growth_global_b: val.fee_growth_global_b,
            orders_total_amount_a: val.orders_total_amount_a,
            orders_total_amount_b: val.orders_total_amount_b,
            orders_filled_amount_a: val.orders_filled_amount_a,
            orders_filled_amount_b: val.orders_filled_amount_b,
            olp_fee_owed_a: val.olp_fee_owed_a,
            olp_fee_owed_b: val.olp_fee_owed_b,
        }
    }
}
