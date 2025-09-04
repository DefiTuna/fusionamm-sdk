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
use crate::{generated::shared::DecodedAccount, FusionPool, FUSION_POOL_DISCRIMINATOR};

#[derive(Debug, Clone)]
pub enum FusionPoolFilter {
    FusionPoolConfig(Pubkey),
    TokenMintA(Pubkey),
    TokenMintB(Pubkey),
    TokenVaultA(Pubkey),
    TokenVaultB(Pubkey),
    TickSpacing(u16),
    FeeRate(u16),
    ProtocolFeeRate(u16),
}

impl From<FusionPoolFilter> for RpcFilterType {
    fn from(val: FusionPoolFilter) -> Self {
        match val {
            FusionPoolFilter::FusionPoolConfig(address) => RpcFilterType::Memcmp(Memcmp::new_base58_encoded(11, &address.to_bytes())),
            FusionPoolFilter::TokenMintA(token_mint_a) => RpcFilterType::Memcmp(Memcmp::new_base58_encoded(11, &token_mint_a.to_bytes())),
            FusionPoolFilter::TokenMintB(token_mint_b) => RpcFilterType::Memcmp(Memcmp::new_base58_encoded(43, &token_mint_b.to_bytes())),
            FusionPoolFilter::TokenVaultA(token_vault_a) => RpcFilterType::Memcmp(Memcmp::new_base58_encoded(75, &token_vault_a.to_bytes())),
            FusionPoolFilter::TokenVaultB(token_vault_b) => RpcFilterType::Memcmp(Memcmp::new_base58_encoded(107, &token_vault_b.to_bytes())),
            FusionPoolFilter::TickSpacing(tick_spacing) => RpcFilterType::Memcmp(Memcmp::new_base58_encoded(139, &tick_spacing.to_le_bytes())),
            FusionPoolFilter::FeeRate(fee_rate) => RpcFilterType::Memcmp(Memcmp::new_base58_encoded(143, &fee_rate.to_le_bytes())),
            FusionPoolFilter::ProtocolFeeRate(protocol_fee_rate) => {
                RpcFilterType::Memcmp(Memcmp::new_base58_encoded(145, &protocol_fee_rate.to_le_bytes()))
            }
        }
    }
}

pub async fn fetch_all_fusion_pool_with_filter(
    rpc: &RpcClient,
    filters: Vec<FusionPoolFilter>,
) -> Result<Vec<DecodedAccount<FusionPool>>, Box<dyn Error>> {
    let mut filters: Vec<RpcFilterType> = filters.into_iter().map(|filter| filter.into()).collect();
    filters.push(RpcFilterType::Memcmp(Memcmp::new_base58_encoded(0, &FUSION_POOL_DISCRIMINATOR)));
    fetch_decoded_program_accounts(rpc, filters).await
}
