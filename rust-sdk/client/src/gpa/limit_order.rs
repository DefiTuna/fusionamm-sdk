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

use crate::{generated::shared::DecodedAccount, LimitOrder, LIMIT_ORDER_DISCRIMINATOR};

use super::fetch_decoded_program_accounts;

#[derive(Debug, Clone)]
pub enum LimitOrderFilter {
    FusionPool(Pubkey),
    Mint(Pubkey),
}

impl From<LimitOrderFilter> for RpcFilterType {
    fn from(val: LimitOrderFilter) -> Self {
        match val {
            LimitOrderFilter::FusionPool(address) => RpcFilterType::Memcmp(Memcmp::new_base58_encoded(10, &address.to_bytes())),
            LimitOrderFilter::Mint(address) => RpcFilterType::Memcmp(Memcmp::new_base58_encoded(42, &address.to_bytes())),
        }
    }
}

pub async fn fetch_all_limit_order_with_filter(
    rpc: &RpcClient,
    filters: Vec<LimitOrderFilter>,
) -> Result<Vec<DecodedAccount<LimitOrder>>, Box<dyn Error>> {
    let mut filters: Vec<RpcFilterType> = filters.into_iter().map(|filter| filter.into()).collect();
    filters.push(RpcFilterType::Memcmp(Memcmp::new_base58_encoded(0, &LIMIT_ORDER_DISCRIMINATOR)));
    fetch_decoded_program_accounts(rpc, filters).await
}
