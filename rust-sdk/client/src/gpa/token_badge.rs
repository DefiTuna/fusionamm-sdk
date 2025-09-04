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
use crate::{generated::shared::DecodedAccount, TokenBadge, TOKEN_BADGE_DISCRIMINATOR};

#[derive(Debug, Clone)]
pub enum TokenBadgeFilter {
    FusionPoolsConfig(Pubkey),
    TokenMint(Pubkey),
}

impl From<TokenBadgeFilter> for RpcFilterType {
    fn from(val: TokenBadgeFilter) -> Self {
        match val {
            TokenBadgeFilter::FusionPoolsConfig(address) => RpcFilterType::Memcmp(Memcmp::new_base58_encoded(8, &address.to_bytes())),
            TokenBadgeFilter::TokenMint(address) => RpcFilterType::Memcmp(Memcmp::new_base58_encoded(40, &address.to_bytes())),
        }
    }
}

pub async fn fetch_all_token_badge_with_filter(
    rpc: &RpcClient,
    filters: Vec<TokenBadgeFilter>,
) -> Result<Vec<DecodedAccount<TokenBadge>>, Box<dyn Error>> {
    let mut filters: Vec<RpcFilterType> = filters.into_iter().map(|filter| filter.into()).collect();
    filters.push(RpcFilterType::Memcmp(Memcmp::new_base58_encoded(0, &TOKEN_BADGE_DISCRIMINATOR)));
    fetch_decoded_program_accounts(rpc, filters).await
}
