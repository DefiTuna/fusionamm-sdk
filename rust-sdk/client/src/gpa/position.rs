//
// Copyright (c) Cryptic Dot
//
// Modification based on Orca Whirlpools (https://github.com/orca-so/whirlpools),
// originally licensed under the Apache License, Version 2.0, prior to February 26, 2025.
//
// Modifications licensed under FusionAMM SDK Source-Available License v1.0
// See the LICENSE file in the project root for license information.
//

use std::error::Error;

use solana_client::{
    nonblocking::rpc_client::RpcClient,
    rpc_filter::{Memcmp, RpcFilterType},
};
use solana_pubkey::Pubkey;

use crate::{generated::shared::DecodedAccount, Position, POSITION_DISCRIMINATOR};

use super::fetch_decoded_program_accounts;

#[derive(Debug, Clone)]
pub enum PositionFilter {
    FusionPool(Pubkey),
    Mint(Pubkey),
    TickLowerIndex(i32),
    TickUpperIndex(i32),
}

impl From<PositionFilter> for RpcFilterType {
    fn from(val: PositionFilter) -> Self {
        match val {
            PositionFilter::FusionPool(address) => RpcFilterType::Memcmp(Memcmp::new_base58_encoded(10, &address.to_bytes())),
            PositionFilter::Mint(address) => RpcFilterType::Memcmp(Memcmp::new_base58_encoded(42, &address.to_bytes())),
            PositionFilter::TickLowerIndex(tick_lower_index) => {
                RpcFilterType::Memcmp(Memcmp::new_base58_encoded(90, &tick_lower_index.to_le_bytes()))
            }
            PositionFilter::TickUpperIndex(tick_upper_index) => {
                RpcFilterType::Memcmp(Memcmp::new_base58_encoded(94, &tick_upper_index.to_le_bytes()))
            }
        }
    }
}

pub async fn fetch_all_position_with_filter(rpc: &RpcClient, filters: Vec<PositionFilter>) -> Result<Vec<DecodedAccount<Position>>, Box<dyn Error>> {
    let mut filters: Vec<RpcFilterType> = filters.into_iter().map(|filter| filter.into()).collect();
    filters.push(RpcFilterType::Memcmp(Memcmp::new_base58_encoded(0, &POSITION_DISCRIMINATOR)));
    fetch_decoded_program_accounts(rpc, filters).await
}
