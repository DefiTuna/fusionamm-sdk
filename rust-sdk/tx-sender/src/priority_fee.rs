//
// Copyright (c) Cryptic Dot
//
// Licensed under FusionAMM SDK Source-Available License v1.0
// See the LICENSE file in the project root for license information.
//

use solana_client::client_error::ClientError;
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_pubkey::Pubkey;
use std::collections::HashMap;

#[derive(Debug, Copy, Clone, PartialEq, Eq, Hash, Ord, PartialOrd)]
pub enum PriorityFeeLevel {
    None,
    Low,
    Medium,
    High,
    VeryHigh,
    Ultimate,
    Custom(u64),
}

#[allow(clippy::result_large_err)]
pub async fn get_priority_fee_estimate(client: &RpcClient, addresses: Vec<Pubkey>, level: PriorityFeeLevel) -> Result<u64, ClientError> {
    if level == PriorityFeeLevel::None {
        return Ok(0);
    }

    if let PriorityFeeLevel::Custom(fee) = level {
        return Ok(fee);
    }

    let recent_prioritization_fees = get_priority_fee_levels_estimate(client, addresses).await?;
    let fee = recent_prioritization_fees.get(&level).copied().unwrap_or(0);

    Ok(fee)
}

#[allow(clippy::result_large_err)]
pub async fn get_priority_fee_levels_estimate(client: &RpcClient, addresses: Vec<Pubkey>) -> Result<HashMap<PriorityFeeLevel, u64>, ClientError> {
    let mut priority_fees: HashMap<PriorityFeeLevel, u64> = [
        (PriorityFeeLevel::None, 0),
        (PriorityFeeLevel::Low, 0),
        (PriorityFeeLevel::Medium, 0),
        (PriorityFeeLevel::High, 0),
        (PriorityFeeLevel::VeryHigh, 0),
        (PriorityFeeLevel::Ultimate, 0),
    ]
    .into_iter()
    .collect();

    let recent_prioritization_fees = client.get_recent_prioritization_fees(&addresses).await?;
    if recent_prioritization_fees.is_empty() {
        return Ok(priority_fees);
    }

    let mut sorted_fees: Vec<_> = recent_prioritization_fees.into_iter().collect();
    sorted_fees.sort_by(|a, b| b.slot.cmp(&a.slot));
    let chunk_size = 150;
    let chunks: Vec<_> = sorted_fees.chunks(chunk_size).take(3).collect();
    let mut percentiles: HashMap<u8, u64> = HashMap::new();
    for chunk in chunks.iter() {
        let fees: Vec<u64> = chunk.iter().map(|fee| fee.prioritization_fee).collect();
        percentiles = calculate_percentiles(&fees);
    }

    priority_fees.insert(PriorityFeeLevel::Low, *percentiles.get(&70).unwrap_or(&0));
    priority_fees.insert(PriorityFeeLevel::Medium, *percentiles.get(&75).unwrap_or(&0));
    priority_fees.insert(PriorityFeeLevel::High, *percentiles.get(&80).unwrap_or(&0));
    priority_fees.insert(PriorityFeeLevel::VeryHigh, *percentiles.get(&85).unwrap_or(&0));
    priority_fees.insert(PriorityFeeLevel::Ultimate, *percentiles.get(&95).unwrap_or(&0));

    Ok(priority_fees)
}

fn calculate_percentiles(fees: &[u64]) -> HashMap<u8, u64> {
    let mut sorted_fees = fees.to_vec();
    sorted_fees.sort_unstable();
    let len = sorted_fees.len();
    let percentiles = vec![70, 75, 80, 85, 95];
    percentiles
        .into_iter()
        .map(|p| {
            let index = (p as f64 / 100.0 * len as f64).round() as usize;
            (p, sorted_fees[index.saturating_sub(1)])
        })
        .collect()
}
