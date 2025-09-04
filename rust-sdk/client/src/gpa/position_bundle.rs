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
use solana_client::rpc_filter::Memcmp;
use solana_client::rpc_filter::RpcFilterType;
use solana_pubkey::Pubkey;

use crate::{generated::shared::DecodedAccount, PositionBundle, POSITION_BUNDLE_DISCRIMINATOR};

use super::fetch_decoded_program_accounts;

#[derive(Debug, Clone)]
pub enum PositionBundleFilter {
    Mint(Pubkey),
}

impl From<PositionBundleFilter> for RpcFilterType {
    fn from(val: PositionBundleFilter) -> Self {
        match val {
            PositionBundleFilter::Mint(address) => RpcFilterType::Memcmp(Memcmp::new_base58_encoded(8, &address.to_bytes())),
        }
    }
}

pub async fn fetch_all_position_bundle_with_filter(
    rpc: &RpcClient,
    filters: Vec<PositionBundleFilter>,
) -> Result<Vec<DecodedAccount<PositionBundle>>, Box<dyn Error>> {
    let mut filters: Vec<RpcFilterType> = filters.into_iter().map(|filter| filter.into()).collect();
    filters.push(RpcFilterType::Memcmp(Memcmp::new_base58_encoded(0, &POSITION_BUNDLE_DISCRIMINATOR)));
    fetch_decoded_program_accounts(rpc, filters).await
}
