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

use fusionamm_client::FusionPool;
use fusionamm_client::{get_fusion_pool_address, get_fusion_pools_config_address, get_token_badge_address};
use fusionamm_client::{InitializePool, InitializePoolInstructionArgs};
use fusionamm_core::price_to_sqrt_price;
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_keypair::Keypair;
use solana_program::rent::Rent;
use solana_program::sysvar::SysvarId;
use solana_program::{instruction::Instruction, pubkey::Pubkey};
use solana_sdk_ids::system_program;
use solana_signer::Signer;
use spl_token_2022::extension::StateWithExtensions;
use spl_token_2022::state::Mint;

use crate::{get_account_data_size, get_rent, order_mints, FUNDER};

/// Represents the instructions and metadata for creating a pool.
pub struct CreatePoolInstructions {
    /// The list of instructions needed to create the pool.
    pub instructions: Vec<Instruction>,

    /// The estimated rent exemption cost for initializing the pool, in lamports.
    pub initialization_cost: u64,

    /// The address of the newly created pool.
    pub pool_address: Pubkey,

    /// The list of signers for the instructions.
    pub additional_signers: Vec<Keypair>,
}

/// Creates the necessary instructions to initialize a Concentrated Liquidity Pool (CLMM).
///
/// # Arguments
///
/// * `rpc` - A reference to a Solana RPC client for communicating with the blockchain.
/// * `token_a` - The public key of the first token mint address to include in the pool.
/// * `token_b` - The public key of the second token mint address to include in the pool.
/// * `tick_spacing` - The spacing between price ticks for the pool.
/// * `fee_rate` - Pool fee rate.
/// * `initial_price` - An optional initial price of token A in terms of token B. Defaults to 1.0 if not provided.
/// * `funder` - An optional public key of the account funding the initialization process. Defaults to the global funder if not provided.
///
/// # Returns
///
/// A `Result` containing `CreatePoolInstructions` on success:
/// * `instructions` - A vector of Solana instructions needed to initialize the pool.
/// * `initialization_cost` - The estimated rent exemption cost for initializing the pool, in lamports.
/// * `pool_address` - The public key of the newly created pool.
/// * `additional_signers` - A vector of `Keypair` objects representing additional signers required for the instructions.
///
/// # Errors
///
/// This function will return an error if:
/// - The funder account is invalid.
/// - Token mints are not found or have invalid data.
/// - The token mint order does not match the canonical byte order.
/// - Any RPC request to the blockchain fails.
///
/// # Example
///
/// ```
/// use fusionamm_sdk::create_fusion_pool_instructions;
/// use solana_client::nonblocking::rpc_client::RpcClient;
/// use solana_keypair::Keypair;
/// use solana_pubkey::pubkey;
/// use solana_signer::Signer;
///
/// #[tokio::main]
/// async fn main() {
///     let rpc = RpcClient::new("https://api.devnet.solana.com".to_string());
///     let token_a = pubkey!("So11111111111111111111111111111111111111112");
///     let token_b = pubkey!("BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k"); // devUSDC
///     let tick_spacing = 64;
///     let fee_rate = 300;
///     let initial_price = Some(0.01);
///     let wallet = Keypair::new(); // CAUTION: This wallet is not persistent.
///     let funder = Some(wallet.pubkey());
///
///     let create_pool_instructions = create_fusion_pool_instructions(
///         &rpc,
///         token_a,
///         token_b,
///         tick_spacing,
///         fee_rate,
///         initial_price,
///         funder,
///     )
///     .await
///     .unwrap();
///
///     println!("Pool Address: {:?}", create_pool_instructions.pool_address);
///     println!(
///         "Initialization Cost: {} lamports",
///         create_pool_instructions.initialization_cost
///     );
/// }
/// ```
pub async fn create_fusion_pool_instructions(
    rpc: &RpcClient,
    token_a: Pubkey,
    token_b: Pubkey,
    tick_spacing: u16,
    fee_rate: u16,
    initial_price: Option<f64>,
    funder: Option<Pubkey>,
) -> Result<CreatePoolInstructions, Box<dyn Error>> {
    let initial_price = initial_price.unwrap_or(1.0);
    let funder = funder.unwrap_or(*FUNDER.try_lock()?);
    if funder == Pubkey::default() {
        return Err("Funder must be provided".into());
    }
    if order_mints(token_a, token_b)[0] != token_a {
        return Err("Token order needs to be flipped to match the canonical ordering (i.e. sorted on the byte repr. of the mint pubkeys)".into());
    }

    let rent = get_rent(rpc).await?;

    let account_infos = rpc.get_multiple_accounts(&[token_a, token_b]).await?;
    let mint_a_info = account_infos[0].as_ref().ok_or(format!("Mint {} not found", token_a))?;
    let mint_a = StateWithExtensions::<Mint>::unpack(&mint_a_info.data)?;
    let decimals_a = mint_a.base.decimals;
    let token_program_a = mint_a_info.owner;
    let mint_b_info = account_infos[1].as_ref().ok_or(format!("Mint {} not found", token_b))?;
    let mint_b = StateWithExtensions::<Mint>::unpack(&mint_b_info.data)?;
    let decimals_b = mint_b.base.decimals;
    let token_program_b = mint_b_info.owner;

    let initial_sqrt_price: u128 = price_to_sqrt_price(initial_price, decimals_a, decimals_b);

    let pool_address = get_fusion_pool_address(&token_a, &token_b, tick_spacing)?.0;
    let token_badge_a = get_token_badge_address(&token_a)?.0;
    let token_badge_b = get_token_badge_address(&token_b)?.0;

    let token_vault_a = Keypair::new();
    let token_vault_b = Keypair::new();

    let mut instructions = vec![];
    let mut initialization_cost: u64 = 0;

    instructions.push(
        InitializePool {
            fusion_pools_config: get_fusion_pools_config_address()?.0,
            token_mint_a: token_a,
            token_mint_b: token_b,
            token_badge_a,
            token_badge_b,
            funder,
            fusion_pool: pool_address,
            token_vault_a: token_vault_a.pubkey(),
            token_vault_b: token_vault_b.pubkey(),
            token_program_a,
            token_program_b,
            system_program: system_program::id(),
            rent: Rent::id(),
        }
        .instruction(InitializePoolInstructionArgs {
            tick_spacing,
            fee_rate,
            initial_sqrt_price,
        }),
    );

    initialization_cost += rent.minimum_balance(FusionPool::LEN);
    let token_a_space = get_account_data_size(token_program_a, mint_a_info)?;
    initialization_cost += rent.minimum_balance(token_a_space);
    let token_b_space = get_account_data_size(token_program_b, mint_b_info)?;
    initialization_cost += rent.minimum_balance(token_b_space);
    /*
        let full_range = get_full_range_tick_indexes(tick_spacing);
        let lower_tick_index = get_tick_array_start_tick_index(full_range.tick_lower_index, tick_spacing);
        let upper_tick_index = get_tick_array_start_tick_index(full_range.tick_upper_index, tick_spacing);
        let initial_tick_index = sqrt_price_to_tick_index(initial_sqrt_price);
        let current_tick_index = get_tick_array_start_tick_index(initial_tick_index, tick_spacing);

        let tick_array_indexes = HashSet::from([lower_tick_index, upper_tick_index, current_tick_index]);
        for start_tick_index in tick_array_indexes {
            let tick_array_address = get_tick_array_address(&pool_address, start_tick_index)?;
            instructions.push(
                InitializeTickArray {
                    fusion_pool: pool_address,
                    tick_array: tick_array_address.0,
                    funder,
                    system_program: system_program::id(),
                }
                .instruction(InitializeTickArrayInstructionArgs { start_tick_index }),
            );
            initialization_cost += rent.minimum_balance(TickArray::MIN_LEN);
        }
    */
    Ok(CreatePoolInstructions {
        instructions,
        initialization_cost,
        pool_address,
        additional_signers: vec![token_vault_a, token_vault_b],
    })
}

#[cfg(test)]
mod tests {
    use crate::tests::{setup_mint, setup_mint_te, setup_mint_te_fee, RpcContext};

    use super::*;
    use serial_test::serial;

    async fn fetch_pool(rpc: &RpcClient, pool_address: Pubkey) -> Result<FusionPool, Box<dyn Error>> {
        let account = rpc.get_account(&pool_address).await?;
        FusionPool::from_bytes(&account.data).map_err(|e| e.into())
    }

    #[tokio::test]
    #[serial]
    async fn test_error_if_no_funder() {
        let ctx = RpcContext::new().await;
        let mint_a = setup_mint(&ctx).await.unwrap();
        let mint_b = setup_mint(&ctx).await.unwrap();

        let result = create_fusion_pool_instructions(&ctx.rpc, mint_a, mint_b, 64, 300, Some(1.0), None).await;

        assert!(result.is_err());
    }

    #[tokio::test]
    #[serial]
    async fn test_error_if_tokens_not_ordered() {
        let ctx = RpcContext::new().await;
        let mint_a = setup_mint(&ctx).await.unwrap();
        let mint_b = setup_mint(&ctx).await.unwrap();

        let result = create_fusion_pool_instructions(&ctx.rpc, mint_b, mint_a, 64, 300, Some(1.0), Some(ctx.signer.pubkey())).await;

        assert!(result.is_err());
    }

    #[tokio::test]
    #[serial]
    async fn test_create_concentrated_liquidity_pool() {
        let ctx = RpcContext::new().await;
        let mint_a = setup_mint(&ctx).await.unwrap();
        let mint_b = setup_mint(&ctx).await.unwrap();
        let price = 10.0;
        let fee_rate = 300;
        let sqrt_price = price_to_sqrt_price(price, 9, 9);

        let result = create_fusion_pool_instructions(&ctx.rpc, mint_a, mint_b, 64, fee_rate, Some(price), Some(ctx.signer.pubkey()))
            .await
            .unwrap();

        let balance_before = ctx.rpc.get_account(&ctx.signer.pubkey()).await.unwrap().lamports;
        let pool_before = fetch_pool(&ctx.rpc, result.pool_address).await;
        assert!(pool_before.is_err());

        let instructions = result.instructions;
        ctx.send_transaction_with_signers(instructions, result.additional_signers.iter().collect())
            .await
            .unwrap();

        let pool_after = fetch_pool(&ctx.rpc, result.pool_address).await.unwrap();
        let balance_after = ctx.rpc.get_account(&ctx.signer.pubkey()).await.unwrap().lamports;
        let balance_change = balance_before - balance_after;
        let tx_fee = 15000; // 3 signing accounts * 5000 lamports
        let min_rent_exempt = balance_change - tx_fee;

        assert_eq!(result.initialization_cost, min_rent_exempt);
        assert_eq!(sqrt_price, pool_after.sqrt_price);
        assert_eq!(mint_a, pool_after.token_mint_a);
        assert_eq!(mint_b, pool_after.token_mint_b);
        assert_eq!(64, pool_after.tick_spacing);
        assert_eq!(300, pool_after.fee_rate);
    }

    #[tokio::test]
    #[serial]
    async fn test_create_concentrated_liquidity_pool_with_one_te_token() {
        let ctx = RpcContext::new().await;
        let mint = setup_mint(&ctx).await.unwrap();
        let mint_te = setup_mint_te(&ctx, &[]).await.unwrap();
        let price = 10.0;
        let fee_rate = 300;
        let sqrt_price = price_to_sqrt_price(price, 9, 6);

        let result = create_fusion_pool_instructions(&ctx.rpc, mint, mint_te, 64, fee_rate, Some(price), Some(ctx.signer.pubkey()))
            .await
            .unwrap();

        let balance_before = ctx.rpc.get_account(&ctx.signer.pubkey()).await.unwrap().lamports;
        let pool_before = fetch_pool(&ctx.rpc, result.pool_address).await;
        assert!(pool_before.is_err());

        let instructions = result.instructions;
        ctx.send_transaction_with_signers(instructions, result.additional_signers.iter().collect())
            .await
            .unwrap();

        let pool_after = fetch_pool(&ctx.rpc, result.pool_address).await.unwrap();
        let balance_after = ctx.rpc.get_account(&ctx.signer.pubkey()).await.unwrap().lamports;
        let balance_change = balance_before - balance_after;
        let tx_fee = 15000; // 3 signing accounts * 5000 lamports
        let min_rent_exempt = balance_change - tx_fee;

        assert_eq!(result.initialization_cost, min_rent_exempt);
        assert_eq!(sqrt_price, pool_after.sqrt_price);
        assert_eq!(mint, pool_after.token_mint_a);
        assert_eq!(mint_te, pool_after.token_mint_b);
        assert_eq!(64, pool_after.tick_spacing);
        assert_eq!(300, pool_after.fee_rate);
    }

    #[tokio::test]
    #[serial]
    async fn test_create_concentrated_liquidity_pool_with_two_te_tokens() {
        let ctx = RpcContext::new().await;
        let mint_te_a = setup_mint_te(&ctx, &[]).await.unwrap();
        let mint_te_b = setup_mint_te(&ctx, &[]).await.unwrap();
        let price = 10.0;
        let fee_rate = 300;
        let sqrt_price = price_to_sqrt_price(price, 6, 6);

        let result = create_fusion_pool_instructions(&ctx.rpc, mint_te_a, mint_te_b, 64, fee_rate, Some(price), Some(ctx.signer.pubkey()))
            .await
            .unwrap();

        let balance_before = ctx.rpc.get_account(&ctx.signer.pubkey()).await.unwrap().lamports;
        let pool_before = fetch_pool(&ctx.rpc, result.pool_address).await;
        assert!(pool_before.is_err());

        let instructions = result.instructions;
        ctx.send_transaction_with_signers(instructions, result.additional_signers.iter().collect())
            .await
            .unwrap();

        let pool_after = fetch_pool(&ctx.rpc, result.pool_address).await.unwrap();
        let balance_after = ctx.rpc.get_account(&ctx.signer.pubkey()).await.unwrap().lamports;
        let balance_change = balance_before - balance_after;
        let tx_fee = 15000; // 3 signing accounts * 5000 lamports
        let min_rent_exempt = balance_change - tx_fee;

        assert_eq!(result.initialization_cost, min_rent_exempt);
        assert_eq!(sqrt_price, pool_after.sqrt_price);
        assert_eq!(mint_te_a, pool_after.token_mint_a);
        assert_eq!(mint_te_b, pool_after.token_mint_b);
        assert_eq!(64, pool_after.tick_spacing);
        assert_eq!(300, pool_after.fee_rate);
    }

    #[tokio::test]
    #[serial]
    async fn test_create_concentrated_liquidity_pool_with_transfer_fee() {
        let ctx = RpcContext::new().await;
        let mint = setup_mint(&ctx).await.unwrap();
        let mint_te_fee = setup_mint_te_fee(&ctx).await.unwrap();
        let price = 10.0;
        let fee_rate = 300;
        let sqrt_price = price_to_sqrt_price(price, 9, 6);

        let result = create_fusion_pool_instructions(&ctx.rpc, mint, mint_te_fee, 64, fee_rate, Some(price), Some(ctx.signer.pubkey()))
            .await
            .unwrap();

        let balance_before = ctx.rpc.get_account(&ctx.signer.pubkey()).await.unwrap().lamports;
        let pool_before = fetch_pool(&ctx.rpc, result.pool_address).await;
        assert!(pool_before.is_err());

        let instructions = result.instructions;
        ctx.send_transaction_with_signers(instructions, result.additional_signers.iter().collect())
            .await
            .unwrap();

        let pool_after = fetch_pool(&ctx.rpc, result.pool_address).await.unwrap();
        let balance_after = ctx.rpc.get_account(&ctx.signer.pubkey()).await.unwrap().lamports;
        let balance_change = balance_before - balance_after;
        let tx_fee = 15000; // 3 signing accounts * 5000 lamports
        let min_rent_exempt = balance_change - tx_fee;

        assert_eq!(result.initialization_cost, min_rent_exempt);
        assert_eq!(sqrt_price, pool_after.sqrt_price);
        assert_eq!(mint, pool_after.token_mint_a);
        assert_eq!(mint_te_fee, pool_after.token_mint_b);
        assert_eq!(64, pool_after.tick_spacing);
        assert_eq!(300, pool_after.fee_rate);
    }
}
