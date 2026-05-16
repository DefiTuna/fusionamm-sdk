//
// Copyright (c) Cryptic Dot
//
// Modification based on Orca Whirlpools (https://github.com/orca-so/whirlpools),
// originally licensed under the Apache License, Version 2.0, prior to February 26, 2025.
//
// Modifications licensed under FusionAMM SDK Source-Available License v1.0
// See the LICENSE file in the project root for license information.
//

use super::rpc::RpcContext;
use fusionamm_client::{
    get_bundled_position_address, get_fusion_pool_address, get_fusion_pools_config_address, get_position_address, get_position_bundle_address,
    get_tick_array_address, get_token_badge_address, FusionPool, InitializePool, InitializePoolInstructionArgs, InitializePositionBundle,
    InitializeTickArray, InitializeTickArrayInstructionArgs, OpenBundledPosition, OpenBundledPositionInstructionArgs, OpenPosition,
    OpenPositionInstructionArgs, FP_NFT_UPDATE_AUTH,
};
use fusionamm_core::{get_initializable_tick_index, get_tick_array_start_tick_index, tick_index_to_sqrt_price, TICK_ARRAY_SIZE};
use solana_program::sysvar::rent::ID as RENT_PROGRAM_ID;
use solana_pubkey::Pubkey;
use solana_sdk_ids::system_program;
use solana_signer::Signer;
use spl_associated_token_account::get_associated_token_address_with_program_id;
use spl_token::ID as TOKEN_PROGRAM_ID;
use spl_token_2022::ID as TOKEN_2022_PROGRAM_ID;
use std::error::Error;

pub async fn init_tick_arrays_for_range(
    ctx: &RpcContext,
    fusion_pool: Pubkey,
    lower_tick_index: i32,
    upper_tick_index: i32,
    spacing: u16,
) -> Result<(), Box<dyn Error>> {
    let (low, high) = if lower_tick_index <= upper_tick_index {
        (lower_tick_index, upper_tick_index)
    } else {
        (upper_tick_index, lower_tick_index)
    };

    let offset = (spacing as i32) * (TICK_ARRAY_SIZE as i32);

    let start_low = get_tick_array_start_tick_index(low, spacing);
    let start_high = get_tick_array_start_tick_index(high, spacing);

    let (begin, end) = if start_low <= start_high {
        (start_low, start_high)
    } else {
        (start_high, start_low)
    };

    let mut instructions = vec![];

    let mut current = begin;
    while current <= end {
        let (tick_array_addr, _) = get_tick_array_address(&fusion_pool, current)?;

        let account_result = ctx.rpc.get_account(&tick_array_addr).await;
        if account_result.is_err() {
            instructions.push(
                InitializeTickArray {
                    fusion_pool,
                    funder: ctx.signer.pubkey(),
                    tick_array: tick_array_addr,
                    system_program: system_program::id(),
                }
                .instruction(InitializeTickArrayInstructionArgs { start_tick_index: current }),
            );
        }

        current += offset;
    }

    if !instructions.is_empty() {
        ctx.send_transaction(instructions).await?;
    }

    Ok(())
}

pub async fn setup_fusion_pool(
    ctx: &RpcContext,
    token_a: Pubkey,
    token_b: Pubkey,
    tick_spacing: u16,
    fee_rate: u16,
) -> Result<Pubkey, Box<dyn Error>> {
    let fusion_pool = get_fusion_pool_address(&token_a, &token_b, tick_spacing)?.0;
    let token_badge_a = get_token_badge_address(&token_a)?.0;
    let token_badge_b = get_token_badge_address(&token_b)?.0;

    let vault_a = ctx.get_next_keypair();
    let vault_b = ctx.get_next_keypair();

    let mint_a_info = ctx.rpc.get_account(&token_a).await?;
    let mint_b_info = ctx.rpc.get_account(&token_b).await?;

    // Default initial price of 1.0
    let sqrt_price = tick_index_to_sqrt_price(0);

    let instructions = vec![InitializePool {
        fusion_pool,
        token_mint_a: token_a,
        token_mint_b: token_b,
        fusion_pools_config: get_fusion_pools_config_address()?.0,
        funder: ctx.signer.pubkey(),
        token_vault_a: vault_a.pubkey(),
        token_vault_b: vault_b.pubkey(),
        token_badge_a,
        token_badge_b,
        token_program_a: mint_a_info.owner,
        token_program_b: mint_b_info.owner,
        system_program: system_program::id(),
        rent: RENT_PROGRAM_ID,
    }
    .instruction(InitializePoolInstructionArgs {
        tick_spacing,
        fee_rate,
        initial_sqrt_price: sqrt_price,
    })];

    ctx.send_transaction_with_signers(instructions, vec![&vault_a, &vault_b]).await?;

    Ok(fusion_pool)
}

pub async fn setup_position(
    ctx: &RpcContext,
    fusion_pool: Pubkey,
    tick_range: Option<(i32, i32)>,
    owner: Option<Pubkey>,
) -> Result<Pubkey, Box<dyn Error>> {
    let owner = owner.unwrap_or_else(|| ctx.signer.pubkey());
    let fusion_pool_data = ctx.rpc.get_account(&fusion_pool).await?;
    let fusion_pool_account = FusionPool::from_bytes(&fusion_pool_data.data)?;

    // Get tick range
    let (tick_lower, tick_upper) = tick_range.unwrap_or((-100, 100));

    // Get initializable tick indexes
    let lower_tick_index = get_initializable_tick_index(tick_lower, fusion_pool_account.tick_spacing, None);
    let upper_tick_index = get_initializable_tick_index(tick_upper, fusion_pool_account.tick_spacing, None);

    let tick_arrays = [
        get_tick_array_start_tick_index(lower_tick_index, fusion_pool_account.tick_spacing),
        get_tick_array_start_tick_index(upper_tick_index, fusion_pool_account.tick_spacing),
    ];
    init_tick_arrays_for_range(ctx, fusion_pool, tick_lower, tick_upper, fusion_pool_account.tick_spacing).await?;

    for start_tick in tick_arrays.iter() {
        let (tick_array_address, _) = get_tick_array_address(&fusion_pool, *start_tick)?;

        let account_result = ctx.rpc.get_account(&tick_array_address).await;
        let needs_init = match account_result {
            Ok(account) => account.data.is_empty(),
            Err(_) => true,
        };

        if needs_init {
            let init_tick_array_ix = InitializeTickArray {
                fusion_pool,
                funder: ctx.signer.pubkey(),
                tick_array: tick_array_address,
                system_program: system_program::id(),
            }
            .instruction(InitializeTickArrayInstructionArgs {
                start_tick_index: *start_tick,
            });

            ctx.send_transaction(vec![init_tick_array_ix]).await?;
        }
    }

    let te_position_mint = ctx.get_next_keypair();

    let (position_pubkey, _) = get_position_address(&te_position_mint.pubkey())?;

    let position_token_account =
        get_associated_token_address_with_program_id(&ctx.signer.pubkey(), &te_position_mint.pubkey(), &TOKEN_2022_PROGRAM_ID);

    let open_position_ix = OpenPosition {
        funder: ctx.signer.pubkey(),
        owner,
        position: position_pubkey,
        position_mint: te_position_mint.pubkey(),
        position_token_account,
        fusion_pool,
        token2022_program: TOKEN_2022_PROGRAM_ID,
        system_program: system_program::id(),
        associated_token_program: spl_associated_token_account::id(),
        metadata_update_auth: FP_NFT_UPDATE_AUTH,
    }
    .instruction(OpenPositionInstructionArgs {
        tick_lower_index: lower_tick_index,
        tick_upper_index: upper_tick_index,
        with_token_metadata_extension: true,
    });

    ctx.send_transaction_with_signers(vec![open_position_ix], vec![&te_position_mint]).await?;

    Ok(te_position_mint.pubkey())
}

pub async fn setup_position_bundle(fusion_pool: Pubkey, bundle_positions: Option<Vec<()>>) -> Result<Pubkey, Box<dyn Error>> {
    let ctx = RpcContext::new().await;

    let position_bundle_mint = ctx.get_next_keypair();
    let (position_bundle_address, _bundle_bump) = get_position_bundle_address(&position_bundle_mint.pubkey())?;

    let open_bundle_ix = InitializePositionBundle {
        funder: ctx.signer.pubkey(),
        position_bundle: position_bundle_address,
        position_bundle_mint: position_bundle_mint.pubkey(),
        position_bundle_token_account: Pubkey::default(),
        position_bundle_owner: ctx.signer.pubkey(),
        token_program: TOKEN_PROGRAM_ID,
        system_program: system_program::id(),
        associated_token_program: spl_associated_token_account::id(),
        rent: RENT_PROGRAM_ID,
    }
    .instruction();

    ctx.send_transaction_with_signers(vec![open_bundle_ix], vec![&position_bundle_mint])
        .await?;

    if let Some(positions) = bundle_positions {
        for (i, _) in positions.iter().enumerate() {
            let bundle_index = i as u16;
            let (bundled_position_address, _) = get_bundled_position_address(&position_bundle_mint.pubkey(), bundle_index as u8)?;

            let open_bundled_ix = OpenBundledPosition {
                funder: ctx.signer.pubkey(),
                bundled_position: bundled_position_address,
                position_bundle: position_bundle_address,
                position_bundle_authority: ctx.signer.pubkey(),
                position_bundle_token_account: Pubkey::default(),
                fusion_pool,
                system_program: system_program::id(),
                rent: RENT_PROGRAM_ID,
            }
            .instruction(OpenBundledPositionInstructionArgs {
                tick_lower_index: -128,
                tick_upper_index: 128,
                bundle_index,
            });

            ctx.send_transaction(vec![open_bundled_ix]).await?;
        }
    }

    Ok(position_bundle_address)
}
