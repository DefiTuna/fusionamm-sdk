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

use super::fetch_decoded_program_accounts;
use crate::POSITION_LOCK_DISCRIMINATOR;
use crate::{generated::shared::DecodedAccount, PositionLock};
use solana_client::{
    nonblocking::rpc_client::RpcClient,
    rpc_filter::{Memcmp, RpcFilterType},
};
use solana_pubkey::Pubkey;

#[derive(Clone, Debug)]
pub enum PositionLockFilter {
    Position(Pubkey),
    PositionOwner(Pubkey),
    FusionPool(Pubkey),
}

impl From<PositionLockFilter> for RpcFilterType {
    fn from(val: PositionLockFilter) -> Self {
        match val {
            PositionLockFilter::Position(address) => RpcFilterType::Memcmp(Memcmp::new_raw_bytes(8, address.to_bytes().to_vec())),
            PositionLockFilter::PositionOwner(address) => RpcFilterType::Memcmp(Memcmp::new_raw_bytes(40, address.to_bytes().to_vec())),
            PositionLockFilter::FusionPool(address) => RpcFilterType::Memcmp(Memcmp::new_raw_bytes(72, address.to_bytes().to_vec())),
        }
    }
}

pub async fn fetch_all_position_lock_with_filter(
    rpc: &RpcClient,
    filters: Vec<PositionLockFilter>,
) -> Result<Vec<DecodedAccount<PositionLock>>, Box<dyn Error>> {
    let mut filters: Vec<RpcFilterType> = filters.into_iter().map(|filter| filter.into()).collect();
    filters.push(RpcFilterType::Memcmp(Memcmp::new_raw_bytes(0, POSITION_LOCK_DISCRIMINATOR.to_vec())));
    fetch_decoded_program_accounts(rpc, filters).await
}
