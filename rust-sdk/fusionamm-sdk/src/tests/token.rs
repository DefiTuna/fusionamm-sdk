//
// Copyright (c) Cryptic Dot
//
// Modification based on Orca Whirlpools (https://github.com/orca-so/whirlpools),
// originally licensed under the Apache License, Version 2.0, prior to February 26, 2025.
//
// Modifications licensed under FusionAMM SDK Source-Available License v1.0
// See the LICENSE file in the project root for license information.
//

use super::RpcContext;
use solana_program::program_pack::Pack;
use solana_program::system_instruction::{create_account, transfer};
use solana_pubkey::Pubkey;
use solana_signer::Signer;
use spl_associated_token_account::{get_associated_token_address_with_program_id, instruction::create_associated_token_account_idempotent};
use spl_token::{
    instruction::{initialize_mint2, mint_to, sync_native},
    native_mint,
    state::Mint,
    ID as TOKEN_PROGRAM_ID,
};
use std::error::Error;

pub async fn setup_ata(ctx: &RpcContext, mint: Pubkey) -> Result<Pubkey, Box<dyn Error>> {
    setup_ata_with_amount(ctx, mint, 0).await
}

pub async fn setup_ata_with_amount(ctx: &RpcContext, mint: Pubkey, amount: u64) -> Result<Pubkey, Box<dyn Error>> {
    let ata = get_associated_token_address_with_program_id(&ctx.signer.pubkey(), &mint, &TOKEN_PROGRAM_ID);

    let mut instructions = vec![create_associated_token_account_idempotent(
        &ctx.signer.pubkey(),
        &ctx.signer.pubkey(),
        &mint,
        &TOKEN_PROGRAM_ID,
    )];

    if amount > 0 {
        if mint.eq(&native_mint::ID) {
            instructions.push(transfer(&ctx.signer.pubkey(), &ata, amount));
            instructions.push(sync_native(&TOKEN_PROGRAM_ID, &ata)?);
        } else {
            instructions.push(mint_to(&TOKEN_PROGRAM_ID, &mint, &ata, &ctx.signer.pubkey(), &[], amount)?);
        }
    }

    ctx.send_transaction(instructions).await?;

    Ok(ata)
}

pub async fn setup_mint(ctx: &RpcContext) -> Result<Pubkey, Box<dyn Error>> {
    setup_mint_with_decimals(ctx, 9).await
}

pub async fn setup_mint_with_decimals(ctx: &RpcContext, decimals: u8) -> Result<Pubkey, Box<dyn Error>> {
    let keypair = ctx.get_next_keypair();

    let instructions = vec![
        create_account(&ctx.signer.pubkey(), &keypair.pubkey(), 1_000_000_000, Mint::LEN as u64, &TOKEN_PROGRAM_ID),
        initialize_mint2(&TOKEN_PROGRAM_ID, &keypair.pubkey(), &ctx.signer.pubkey(), None, decimals)?,
    ];

    ctx.send_transaction_with_signers(instructions, vec![keypair]).await?;

    Ok(keypair.pubkey())
}
