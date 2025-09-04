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

use solana_client::nonblocking::rpc_client::RpcClient;
use solana_client::rpc_filter::{Memcmp, RpcFilterType};
use solana_pubkey::Pubkey;

use super::fetch_decoded_program_accounts;
use crate::{generated::shared::DecodedAccount, TickArray, TICK_ARRAY_DISCRIMINATOR};

#[derive(Debug, Clone)]
pub enum TickArrayFilter {
    FusionPool(Pubkey),
    StartTickIndex(i32),
}

impl From<TickArrayFilter> for RpcFilterType {
    fn from(val: TickArrayFilter) -> Self {
        match val {
            TickArrayFilter::FusionPool(address) => RpcFilterType::Memcmp(Memcmp::new_base58_encoded(113 * 88 + 12, &address.to_bytes())),
            TickArrayFilter::StartTickIndex(tick_index) => RpcFilterType::Memcmp(Memcmp::new_base58_encoded(8, &tick_index.to_le_bytes())),
        }
    }
}

pub async fn fetch_all_tick_array_with_filter(
    rpc: &RpcClient,
    filters: Vec<TickArrayFilter>,
) -> Result<Vec<DecodedAccount<TickArray>>, Box<dyn Error>> {
    let mut filters: Vec<RpcFilterType> = filters.into_iter().map(|filter| filter.into()).collect();
    filters.push(RpcFilterType::Memcmp(Memcmp::new_base58_encoded(0, &TICK_ARRAY_DISCRIMINATOR)));
    fetch_decoded_program_accounts(rpc, filters).await
}
