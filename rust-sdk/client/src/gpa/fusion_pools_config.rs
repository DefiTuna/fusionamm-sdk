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

use super::fetch_decoded_program_accounts;
use crate::{generated::shared::DecodedAccount, FusionPoolsConfig, FUSION_POOLS_CONFIG_DISCRIMINATOR};

#[derive(Debug, Clone)]
pub enum FusionPoolsConfigFilter {
    FeeAuthority(Pubkey),
    CollectProtocolFeesAuthority(Pubkey),
    TokenBadgeAuthority(Pubkey),
    DefaultProtocolFeeRate(u16),
    DefaultProtocolLimitOrderFeeRate(u16),
}

impl From<FusionPoolsConfigFilter> for RpcFilterType {
    fn from(val: FusionPoolsConfigFilter) -> Self {
        match val {
            FusionPoolsConfigFilter::FeeAuthority(address) => RpcFilterType::Memcmp(Memcmp::new_base58_encoded(11, &address.to_bytes())),
            FusionPoolsConfigFilter::CollectProtocolFeesAuthority(address) => {
                RpcFilterType::Memcmp(Memcmp::new_base58_encoded(43, &address.to_bytes()))
            }
            FusionPoolsConfigFilter::TokenBadgeAuthority(address) => RpcFilterType::Memcmp(Memcmp::new_base58_encoded(75, &address.to_bytes())),
            FusionPoolsConfigFilter::DefaultProtocolFeeRate(fee_rate) => {
                RpcFilterType::Memcmp(Memcmp::new_base58_encoded(107, &fee_rate.to_le_bytes()))
            }
            FusionPoolsConfigFilter::DefaultProtocolLimitOrderFeeRate(fee_rate) => {
                RpcFilterType::Memcmp(Memcmp::new_base58_encoded(110, &fee_rate.to_le_bytes()))
            }
        }
    }
}

pub async fn fetch_all_fusion_pools_config_with_filter(
    rpc: &RpcClient,
    filters: Vec<FusionPoolsConfigFilter>,
) -> Result<Vec<DecodedAccount<FusionPoolsConfig>>, Box<dyn Error>> {
    let mut filters: Vec<RpcFilterType> = filters.into_iter().map(|filter| filter.into()).collect();
    filters.push(RpcFilterType::Memcmp(Memcmp::new_base58_encoded(0, &FUSION_POOLS_CONFIG_DISCRIMINATOR)));
    fetch_decoded_program_accounts(rpc, filters).await
}
