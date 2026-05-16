use crate::account::get_rent;
use crate::token::{get_current_transfer_fee, prepare_token_accounts_instructions, TokenAccountStrategy};
use crate::{PriceOrTickIndex, FUNDER};
use fusionamm_client::{
    get_limit_order_address, get_tick_array_address, CloseLimitOrder, DecreaseLimitOrder, DecreaseLimitOrderInstructionArgs, FusionPool,
    IncreaseLimitOrder, IncreaseLimitOrderInstructionArgs, InitializeTickArray, InitializeTickArrayInstructionArgs, LimitOrder, OpenLimitOrder,
    OpenLimitOrderInstructionArgs, TickArray, FP_NFT_UPDATE_AUTH,
};
use fusionamm_core::{
    decrease_limit_order_quote, get_initializable_tick_index, get_tick_array_start_tick_index, price_to_tick_index, try_reverse_apply_transfer_fee,
    LimitOrderDecreaseQuote,
};
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_keypair::Keypair;
use solana_program::instruction::Instruction;
use solana_program::program_pack::Pack;
use solana_program::pubkey::Pubkey;
use solana_signer::Signer;
use spl_associated_token_account::get_associated_token_address_with_program_id;
use spl_token_2022::state::Mint;
use std::error::Error;

#[derive(Debug)]
pub struct OpenLimitOrderInstruction {
    /// The public key of the limit order NFT that represents ownership of the newly opened order.
    pub limit_order_mint: Pubkey,

    /// A vector of `Instruction` objects required to execute the limit order opening.
    pub instructions: Vec<Instruction>,

    /// A vector of `Keypair` objects representing additional signers required for the instructions.
    pub additional_signers: Vec<Keypair>,

    /// The amount of required token A
    pub quote_a: u64,

    /// The amount of required token B
    pub quote_b: u64,

    /// The cost of initializing the limit order, measured in lamports.
    pub initialization_cost: u64,
}

#[derive(Debug)]
pub struct IncreaseLimitOrderInstruction {
    /// A vector of `Instruction` objects required to execute the limit order increasing.
    pub instructions: Vec<Instruction>,

    /// The amount of required token A
    pub quote_a: u64,

    /// The amount of required token B
    pub quote_b: u64,

    /// A vector of `Keypair` objects representing additional signers required for the instructions.
    pub additional_signers: Vec<Keypair>,
}

#[derive(Debug)]
pub struct DecreaseLimitOrderInstruction {
    /// A vector of `Instruction` objects required to execute the limit order decreasing or closing.
    pub instructions: Vec<Instruction>,

    /// The limit order decrease quote.
    pub quote: LimitOrderDecreaseQuote,

    /// A vector of `Keypair` objects representing additional signers required for the instructions.
    pub additional_signers: Vec<Keypair>,
}

#[cfg(not(doctest))]
/// Opens a limit order in a liquidity pool at a specific tick index.
///
/// # Arguments
///
/// * `rpc` - A reference to the Solana RPC client.
/// * `pool_address` - The public key of the liquidity pool.
/// * `amount` - The limit order input token amount.
/// * `price_or_tick_index` - The price or tick index for the limit order.
/// * `a_to_b` - The limit order swap direction.
/// * `funder` - An optional public key of the funder account. Defaults to the global funder if not provided.
///
/// # Returns
///
/// Returns a `Result` containing an `OpenLimitOrderInstruction` on success, which includes:
/// * `limit_order_mint` - The mint address of the limit order NFT.
/// * `instructions` - A vector of `Instruction` objects required for opening the limit order.
/// * `additional_signers` - A vector of `Keypair` objects for additional transaction signers.
/// * `initialization_cost` - The cost of initializing the limit order, in lamports.
///
/// # Errors
///
/// Returns an error if:
/// - The funder account is invalid.
/// - The pool account is not found or invalid.
/// - Any RPC request fails.
///
/// # Example
///
/// ```rust
/// use fusionamm_sdk::{open_limit_order_instructions, PriceOrTickIndex};
/// use solana_client::nonblocking::rpc_client::RpcClient;
/// use solana_pubkey::pubkey;
/// use solana_keypair::Keypair;
/// use solana_signer::Signer;
///
/// #[tokio::main]
/// async fn main() {
///     let rpc = RpcClient::new("https://api.mainnet.solana.com".to_string());
///     let wallet = Keypair::new(); // Load your wallet here
///
///     let fusion_pool_pubkey = pubkey!("7VuKeevbvbQQcxz6N4SNLmuq6PYy4AcGQRDssoqo4t65");
///     let amount = 1_000_000;
///     let limit_order_price = 100.5;
///     let a_to_b = true;
///
///     let funder = Some(wallet.pubkey());
///
///     let result = open_limit_order_instructions(
///         &rpc,
///         fusion_pool_pubkey,
///         amount,
///         PriceOrTickIndex::Price(limit_order_price),
///         a_to_b,
///         funder,
///     )
///     .await
///     .unwrap();
///
///     println!("Limit Order Mint: {:?}", result.limit_order_mint);
///     println!("Initialization Cost: {} lamports", result.initialization_cost);
/// }
/// ```
pub async fn open_limit_order_instructions(
    rpc: &RpcClient,
    pool_address: Pubkey,
    amount: u64,
    price_or_tick_index: PriceOrTickIndex,
    a_to_b: bool,
    funder: Option<Pubkey>,
) -> Result<OpenLimitOrderInstruction, Box<dyn Error>> {
    let funder = funder.unwrap_or(*FUNDER.try_lock()?);
    let rent = get_rent(rpc).await?;
    if funder == Pubkey::default() {
        return Err("Funder must be provided".into());
    }

    let fusion_pool_info = rpc.get_account(&pool_address).await?;
    let fusion_pool = FusionPool::from_bytes(&fusion_pool_info.data)?;

    let mint_infos = rpc.get_multiple_accounts(&[fusion_pool.token_mint_a, fusion_pool.token_mint_b]).await?;

    // Use 'unpack_from_slice' instead of 'unpack' because the account length might be larger than Mint::LEN due to extensions.
    let mint_a_info = mint_infos[0].as_ref().ok_or("Token A mint info not found")?;
    if mint_a_info.data.len() < Mint::LEN {
        return Err("Wrong token A mint account length".into());
    }
    let mint_a = Mint::unpack_from_slice(&mint_a_info.data).expect("Failed to unpack token A mint");
    let mint_b_info = mint_infos[1].as_ref().ok_or("Token B mint info not found")?;
    if mint_b_info.data.len() < Mint::LEN {
        return Err("Wrong token B mint account length".into());
    }
    let mint_b = Mint::unpack_from_slice(&mint_b_info.data).expect("Failed to unpack token B mint");

    let tick_index = match price_or_tick_index {
        PriceOrTickIndex::Tick(tick_index) => tick_index,
        PriceOrTickIndex::Price(price) => price_to_tick_index(price, mint_a.decimals, mint_b.decimals),
    };

    let (mint_address, mint_info) = if a_to_b {
        (fusion_pool.token_mint_a, mint_a_info)
    } else {
        (fusion_pool.token_mint_b, mint_b_info)
    };

    let mut instructions: Vec<Instruction> = Vec::new();
    let mut non_refundable_rent: u64 = 0;
    let mut additional_signers: Vec<Keypair> = Vec::new();

    let initializable_tick_index = get_initializable_tick_index(tick_index, fusion_pool.tick_spacing, Some(false));

    let epoch = rpc.get_epoch_info().await?.epoch;
    let transfer_fee = get_current_transfer_fee(Some(mint_info), epoch);
    let amount_with_fee = if transfer_fee.is_some() {
        try_reverse_apply_transfer_fee(amount, transfer_fee.unwrap_or_default())?
    } else {
        amount
    };

    additional_signers.push(Keypair::new());
    let limit_order_mint = additional_signers[0].pubkey();

    let tick_array_start_index = get_tick_array_start_tick_index(initializable_tick_index, fusion_pool.tick_spacing);

    let limit_order_address = get_limit_order_address(&limit_order_mint)?.0;
    let limit_order_token_account_address = get_associated_token_address_with_program_id(&funder, &limit_order_mint, &spl_token_2022::ID);
    let tick_array_address = get_tick_array_address(&pool_address, tick_array_start_index)?.0;

    let token_accounts =
        prepare_token_accounts_instructions(rpc, funder, vec![TokenAccountStrategy::WithBalance(mint_address, amount_with_fee)]).await?;

    instructions.extend(token_accounts.create_instructions);
    additional_signers.extend(token_accounts.additional_signers);

    let tick_array_info = rpc.get_account(&tick_array_address).await;

    if tick_array_info.is_err() {
        instructions.push(
            InitializeTickArray {
                fusion_pool: pool_address,
                funder,
                tick_array: tick_array_address,
                system_program: solana_program::system_program::id(),
            }
            .instruction(InitializeTickArrayInstructionArgs {
                start_tick_index: tick_array_start_index,
            }),
        );
        non_refundable_rent += rent.minimum_balance(TickArray::MIN_LEN);
    }

    let token_owner_account = token_accounts
        .token_account_addresses
        .get(&mint_address)
        .ok_or("Token owner account not found")?;

    instructions.push(
        OpenLimitOrder {
            funder,
            owner: funder,
            limit_order: limit_order_address,
            limit_order_mint,
            limit_order_token_account: limit_order_token_account_address,
            fusion_pool: pool_address,
            token2022_program: spl_token_2022::ID,
            system_program: solana_program::system_program::id(),
            associated_token_program: spl_associated_token_account::ID,
            metadata_update_auth: FP_NFT_UPDATE_AUTH,
        }
        .instruction(OpenLimitOrderInstructionArgs {
            tick_index,
            a_to_b,
            with_token_metadata_extension: true,
        }),
    );

    instructions.push(
        IncreaseLimitOrder {
            limit_order_authority: funder,
            fusion_pool: pool_address,
            limit_order: limit_order_address,
            limit_order_token_account: limit_order_token_account_address,
            token_mint: mint_address,
            token_owner_account: *token_owner_account,
            token_vault: if a_to_b { fusion_pool.token_vault_a } else { fusion_pool.token_vault_b },
            tick_array: tick_array_address,
            token_program: mint_info.owner,
            memo_program: spl_memo::ID,
        }
        .instruction(IncreaseLimitOrderInstructionArgs {
            amount,
            remaining_accounts_info: None,
        }),
    );

    instructions.extend(token_accounts.cleanup_instructions);

    Ok(OpenLimitOrderInstruction {
        limit_order_mint,
        instructions,
        additional_signers,
        quote_a: if a_to_b { amount_with_fee } else { 0 },
        quote_b: if a_to_b { 0 } else { amount_with_fee },
        initialization_cost: non_refundable_rent,
    })
}

/// Increases a limit order.
/// The limit order can't be increased if it's partially filled.
///
/// # Arguments
///
/// * `rpc` - A reference to the Solana RPC client.
/// * `limit_order_mint` - The public key of the NFT mint address representing the limit order to be increased.
/// * `amount` - The amount of input tokens by which to increase the limit order.
/// * `authority` - An optional public key of the account authorizing the transaction. Defaults to the global funder if not provided.
///
/// # Returns
///
/// Returns a `Result` containing an `OpenLimitOrderInstruction` on success, which includes:
/// * `instructions` - A vector of `Instruction` objects required for increasing the limit order.
/// * `additional_signers` - A vector of `Keypair` objects for additional transaction signers.
///
/// # Errors
///
/// Returns an error if:
/// - The funder account is invalid.
/// - The pool or token mint accounts are not found or invalid.
/// - Any RPC request fails.
pub async fn increase_limit_order_instructions(
    rpc: &RpcClient,
    limit_order_mint: Pubkey,
    amount: u64,
    authority: Option<Pubkey>,
) -> Result<IncreaseLimitOrderInstruction, Box<dyn Error>> {
    let funder = authority.unwrap_or(*FUNDER.try_lock()?);
    if funder == Pubkey::default() {
        return Err("Funder must be provided".into());
    }

    let mut instructions: Vec<Instruction> = Vec::new();

    let limit_order_address = get_limit_order_address(&limit_order_mint)?.0;
    let limit_order_info = rpc.get_account(&limit_order_address).await?;
    let limit_order = LimitOrder::from_bytes(&limit_order_info.data)?;

    let fusion_pool_info = rpc.get_account(&limit_order.fusion_pool).await?;
    let fusion_pool = FusionPool::from_bytes(&fusion_pool_info.data)?;

    let mint_infos = rpc.get_multiple_accounts(&[fusion_pool.token_mint_a, fusion_pool.token_mint_b]).await?;
    let mint_a_info = mint_infos[0].as_ref().ok_or("Token A mint info not found")?;
    let mint_b_info = mint_infos[1].as_ref().ok_or("Token B mint info not found")?;

    let (mint_address, mint_info) = if limit_order.a_to_b {
        (fusion_pool.token_mint_a, mint_a_info)
    } else {
        (fusion_pool.token_mint_b, mint_b_info)
    };

    let tick_array_start_index = get_tick_array_start_tick_index(limit_order.tick_index, fusion_pool.tick_spacing);

    let limit_order_token_account_address = get_associated_token_address_with_program_id(&funder, &limit_order_mint, &spl_token_2022::ID);
    let tick_array_address = get_tick_array_address(&limit_order.fusion_pool, tick_array_start_index)?.0;

    let epoch = rpc.get_epoch_info().await?.epoch;
    let transfer_fee = get_current_transfer_fee(Some(mint_info), epoch);
    let amount_with_fee = if transfer_fee.is_some() {
        try_reverse_apply_transfer_fee(amount, transfer_fee.unwrap_or_default())?
    } else {
        amount
    };

    let token_accounts =
        prepare_token_accounts_instructions(rpc, funder, vec![TokenAccountStrategy::WithBalance(mint_address, amount_with_fee)]).await?;

    instructions.extend(token_accounts.create_instructions);

    let token_owner_account = token_accounts
        .token_account_addresses
        .get(&mint_address)
        .ok_or("Token owner account not found")?;

    instructions.push(
        IncreaseLimitOrder {
            limit_order_authority: funder,
            fusion_pool: limit_order.fusion_pool,
            limit_order: limit_order_address,
            limit_order_token_account: limit_order_token_account_address,
            token_mint: mint_address,
            token_owner_account: *token_owner_account,
            token_vault: if limit_order.a_to_b {
                fusion_pool.token_vault_a
            } else {
                fusion_pool.token_vault_b
            },
            tick_array: tick_array_address,
            token_program: mint_info.owner,
            memo_program: spl_memo::ID,
        }
        .instruction(IncreaseLimitOrderInstructionArgs {
            amount,
            remaining_accounts_info: None,
        }),
    );

    instructions.extend(token_accounts.cleanup_instructions);

    Ok(IncreaseLimitOrderInstruction {
        instructions,
        additional_signers: token_accounts.additional_signers,
        quote_a: if limit_order.a_to_b { amount_with_fee } else { 0 },
        quote_b: if limit_order.a_to_b { 0 } else { amount_with_fee },
    })
}

#[cfg(not(doctest))]
/// Generates instructions to close a limit order.
///
/// This function removes any remaining liquidity, and closes the limit order.
///
/// # Arguments
///
/// * `rpc` - A reference to a Solana RPC client for fetching accounts and pool data.
/// * `limit_order_mint` - The public key of the NFT mint address representing the limit order to be closed.
/// * `authority` - An optional public key of the account authorizing the transaction. Defaults to the global funder if not provided.
///
/// # Returns
///
/// A `Result` containing `DecreaseLimitOrderInstruction` on success:
///
/// * `instructions` - A vector of `Instruction` objects required to execute the limit order closure.
/// * `additional_signers` - A vector of `Keypair` objects representing additional signers required for the instructions.
///
/// # Errors
///
/// This function will return an error if:
/// - The `authority` account is invalid or missing.
/// - The limit order account is not found or have invalid data.
/// - Any RPC request to the blockchain fails.
///
/// # Example
///
/// ```rust
/// use fusionamm_sdk::close_limit_order_instructions;
/// use solana_client::nonblocking::rpc_client::RpcClient;
/// use solana_pubkey::pubkey;
/// use solana_keypair::Keypair;
/// use solana_signer::Signer;
///
/// #[tokio::main]
/// async fn main() {
///     let rpc = RpcClient::new("https://api.mainnet.solana.com".to_string());
///     let wallet = Keypair::new(); // Load your wallet here
///
///     let limit_order_mint_address = pubkey!("HqoV7Qv27REUtmd9UKSJGGmCRNx3531t33bDG1BUfo9K");
///     let authority = Some(wallet.pubkey());
///
///     let result = close_limit_order_instructions(
///         &rpc,
///         limit_order_mint_address,
///         authority,
///     )
///     .await
///     .unwrap();
///
///     println!("Number of Instructions: {}", result.instructions.len());
/// }
/// ```
pub async fn close_limit_order_instructions(
    rpc: &RpcClient,
    limit_order_mint: Pubkey,
    authority: Option<Pubkey>,
) -> Result<DecreaseLimitOrderInstruction, Box<dyn Error>> {
    internal_decrease_and_close_limit_order_instructions(rpc, limit_order_mint, None, authority).await
}

#[cfg(not(doctest))]
/// Generates instructions to decrease a limit order.
///
/// Decrease the existing limit order in a concentrated liquidity pool.
/// Both input and output tokens are removed proportionally.
///
/// # Arguments
///
/// * `rpc` - A reference to a Solana RPC client for fetching accounts and pool data.
/// * `amount` - The share by which the limit order needs to be reduced.
/// * `limit_order_mint` - The public key of the NFT mint address representing the limit order to be decreased.
/// * `authority` - An optional public key of the account authorizing the transaction. Defaults to the global funder if not provided.
///
/// # Returns
///
/// A `Result` containing `DecreaseLimitOrderInstruction` on success:
///
/// * `instructions` - A vector of `Instruction` objects required to execute the limit order closure.
/// * `additional_signers` - A vector of `Keypair` objects representing additional signers required for the instructions.
///
/// # Errors
///
/// This function will return an error if:
/// - The `authority` account is invalid or missing.
/// - The limit order account is not found or have invalid data.
/// - Any RPC request to the blockchain fails.
///
/// # Example
///
/// ```rust
/// use fusionamm_sdk::decrease_limit_order_instructions;
/// use solana_client::nonblocking::rpc_client::RpcClient;
/// use solana_pubkey::pubkey;
/// use solana_keypair::Keypair;
/// use solana_signer::Signer;
///
/// #[tokio::main]
/// async fn main() {
///     let rpc = RpcClient::new("https://api.mainnet.solana.com".to_string());
///     let wallet = Keypair::new(); // Load your wallet here
///
///     let limit_order_mint_address = pubkey!("HqoV7Qv27REUtmd9UKSJGGmCRNx3531t33bDG1BUfo9K");
///     let authority = Some(wallet.pubkey());
///     let amount = 1_000_000;
///
///     let result = decrease_limit_order_instructions(
///         &rpc,
///         limit_order_mint_address,
///         amount,
///         authority,
///     )
///     .await
///     .unwrap();
///
///     println!("Number of Instructions: {}", result.instructions.len());
/// }
/// ```
pub async fn decrease_limit_order_instructions(
    rpc: &RpcClient,
    limit_order_mint: Pubkey,
    amount: u64,
    authority: Option<Pubkey>,
) -> Result<DecreaseLimitOrderInstruction, Box<dyn Error>> {
    internal_decrease_and_close_limit_order_instructions(rpc, limit_order_mint, Some(amount), authority).await
}

async fn internal_decrease_and_close_limit_order_instructions(
    rpc: &RpcClient,
    limit_order_mint: Pubkey,
    amount: Option<u64>,
    authority: Option<Pubkey>,
) -> Result<DecreaseLimitOrderInstruction, Box<dyn Error>> {
    let funder = authority.unwrap_or(*FUNDER.try_lock()?);
    if funder == Pubkey::default() {
        return Err("Funder must be provided".into());
    }

    let mut instructions: Vec<Instruction> = Vec::new();

    let limit_order_address = get_limit_order_address(&limit_order_mint)?.0;
    let limit_order_info = rpc.get_account(&limit_order_address).await?;
    let limit_order = LimitOrder::from_bytes(&limit_order_info.data)?;

    let fusion_pool_info = rpc.get_account(&limit_order.fusion_pool).await?;
    let fusion_pool = FusionPool::from_bytes(&fusion_pool_info.data)?;

    let mint_infos = rpc.get_multiple_accounts(&[fusion_pool.token_mint_a, fusion_pool.token_mint_b]).await?;
    let mint_a_info = mint_infos[0].as_ref().ok_or("Token A mint info not found")?;
    let mint_b_info = mint_infos[1].as_ref().ok_or("Token B mint info not found")?;

    let tick_array_start_index = get_tick_array_start_tick_index(limit_order.tick_index, fusion_pool.tick_spacing);

    let limit_order_token_account_address = get_associated_token_address_with_program_id(&funder, &limit_order_mint, &spl_token_2022::ID);
    let tick_array_address = get_tick_array_address(&limit_order.fusion_pool, tick_array_start_index)?.0;

    let tick_array_info = rpc.get_account(&tick_array_address).await?;
    let tick_array = TickArray::from_bytes(&tick_array_info.data)?;
    let tick = &tick_array.ticks[((limit_order.tick_index - tick_array_start_index) / fusion_pool.tick_spacing as i32) as usize];

    let decrease_amount = match amount {
        None => limit_order.amount,
        Some(amount) => amount,
    };

    let current_epoch = rpc.get_epoch_info().await?.epoch;
    let transfer_fee_a = get_current_transfer_fee(Some(mint_a_info), current_epoch);
    let transfer_fee_b = get_current_transfer_fee(Some(mint_b_info), current_epoch);

    let quote = decrease_limit_order_quote(
        fusion_pool.clone().into(),
        limit_order.clone().into(),
        tick.clone().into(),
        decrease_amount,
        transfer_fee_a,
        transfer_fee_b,
    )?;

    let token_accounts = prepare_token_accounts_instructions(
        rpc,
        funder,
        vec![
            TokenAccountStrategy::WithoutBalance(fusion_pool.token_mint_a),
            TokenAccountStrategy::WithoutBalance(fusion_pool.token_mint_b),
        ],
    )
    .await?;

    instructions.extend(token_accounts.create_instructions);

    instructions.push(
        DecreaseLimitOrder {
            limit_order_authority: funder,
            fusion_pool: limit_order.fusion_pool,
            limit_order: limit_order_address,
            limit_order_token_account: limit_order_token_account_address,
            token_mint_a: fusion_pool.token_mint_a,
            token_mint_b: fusion_pool.token_mint_b,
            token_owner_account_a: *token_accounts.token_account_addresses.get(&fusion_pool.token_mint_a).unwrap(),
            token_owner_account_b: *token_accounts.token_account_addresses.get(&fusion_pool.token_mint_b).unwrap(),
            token_vault_a: fusion_pool.token_vault_a,
            token_vault_b: fusion_pool.token_vault_b,
            tick_array: tick_array_address,
            token_program_a: mint_a_info.owner,
            token_program_b: mint_b_info.owner,
            memo_program: spl_memo::ID,
        }
        .instruction(DecreaseLimitOrderInstructionArgs {
            amount: decrease_amount,
            remaining_accounts_info: None,
        }),
    );

    if amount.is_none() {
        instructions.push(
            CloseLimitOrder {
                limit_order_authority: funder,
                receiver: funder,
                limit_order: limit_order_address,
                limit_order_mint,
                limit_order_token_account: limit_order_token_account_address,
                token2022_program: spl_token_2022::ID,
            }
            .instruction(),
        );
    }

    instructions.extend(token_accounts.cleanup_instructions);

    Ok(DecreaseLimitOrderInstruction {
        instructions,
        quote,
        additional_signers: token_accounts.additional_signers,
    })
}

#[cfg(test)]
mod tests {
    use crate::{
        close_limit_order_instructions, decrease_limit_order_instructions, increase_limit_order_instructions, open_limit_order_instructions,
        tests::{
            setup_ata_te, setup_ata_with_amount, setup_fusion_pool, setup_mint_te, setup_mint_te_fee, setup_mint_with_decimals, RpcContext,
            SetupAtaConfig,
        },
        DecreaseLimitOrderInstruction, IncreaseLimitOrderInstruction, OpenLimitOrderInstruction, PriceOrTickIndex,
    };
    use fusionamm_client::{get_limit_order_address, LimitOrder};
    use rstest::rstest;
    use serial_test::serial;
    use solana_client::nonblocking::rpc_client::RpcClient;
    use solana_keypair::Keypair;
    use solana_program::program_pack::Pack;
    use solana_program_test::tokio;
    use solana_pubkey::Pubkey;
    use solana_signer::Signer;
    use spl_token::state::Account as TokenAccount;
    use spl_token_2022::{extension::StateWithExtensionsOwned, state::Account as TokenAccount2022, ID as TOKEN_2022_PROGRAM_ID};
    use std::collections::HashMap;
    use std::error::Error;

    async fn fetch_limit_order(rpc: &RpcClient, address: Pubkey) -> Result<LimitOrder, Box<dyn Error>> {
        let account = rpc.get_account(&address).await?;
        LimitOrder::from_bytes(&account.data).map_err(|e| e.into())
    }

    async fn get_token_balance(rpc: &RpcClient, address: Pubkey) -> Result<u64, Box<dyn Error>> {
        let account_data = rpc.get_account(&address).await?;

        if account_data.owner == TOKEN_2022_PROGRAM_ID {
            let state = StateWithExtensionsOwned::<TokenAccount2022>::unpack(account_data.data)?;
            Ok(state.base.amount)
        } else {
            let token_account = TokenAccount::unpack(&account_data.data)?;
            Ok(token_account.amount)
        }
    }

    async fn verify_open_limit_order(
        ctx: &RpcContext,
        open_ix: &OpenLimitOrderInstruction,
        amount: u64,
        token_a_account: Pubkey,
        token_b_account: Pubkey,
    ) -> Result<(), Box<dyn Error>> {
        let before_a = get_token_balance(&ctx.rpc, token_a_account).await?;
        let before_b = get_token_balance(&ctx.rpc, token_b_account).await?;

        let signers: Vec<&Keypair> = open_ix.additional_signers.iter().collect();
        ctx.send_transaction_with_signers(open_ix.instructions.clone(), signers).await?;

        let after_a = get_token_balance(&ctx.rpc, token_a_account).await?;
        let after_b = get_token_balance(&ctx.rpc, token_b_account).await?;
        let used_a = before_a.saturating_sub(after_a);
        let used_b = before_b.saturating_sub(after_b);
        assert!(used_a == open_ix.quote_a, "Token A usage mismatch! expected={}, got={}", open_ix.quote_a, used_a);
        assert!(used_b == open_ix.quote_b, "Token B usage mismatch! expected={}, got={}", open_ix.quote_b, used_b);

        let limit_order_address = get_limit_order_address(&open_ix.limit_order_mint)?.0;
        let limit_order = fetch_limit_order(&ctx.rpc, limit_order_address).await?;
        assert_eq!(limit_order.amount, amount, "Limit order amount mismatch! expected={}, got={}", amount, limit_order.amount);

        Ok(())
    }

    async fn verify_increase_limit_order(
        ctx: &RpcContext,
        open_ix: &IncreaseLimitOrderInstruction,
        limit_order_mint: Pubkey,
        amount: u64,
        token_a_account: Pubkey,
        token_b_account: Pubkey,
    ) -> Result<(), Box<dyn Error>> {
        let limit_order_address = get_limit_order_address(&limit_order_mint)?.0;
        let limit_order_before = fetch_limit_order(&ctx.rpc, limit_order_address).await?;

        let before_a = get_token_balance(&ctx.rpc, token_a_account).await?;
        let before_b = get_token_balance(&ctx.rpc, token_b_account).await?;

        let signers: Vec<&Keypair> = open_ix.additional_signers.iter().collect();
        ctx.send_transaction_with_signers(open_ix.instructions.clone(), signers).await?;

        let after_a = get_token_balance(&ctx.rpc, token_a_account).await?;
        let after_b = get_token_balance(&ctx.rpc, token_b_account).await?;
        let used_a = before_a.saturating_sub(after_a);
        let used_b = before_b.saturating_sub(after_b);
        assert!(used_a == open_ix.quote_a, "Token A usage mismatch! expected={}, got={}", open_ix.quote_a, used_a);
        assert!(used_b == open_ix.quote_b, "Token B usage mismatch! expected={}, got={}", open_ix.quote_b, used_b);

        let limit_order_after = fetch_limit_order(&ctx.rpc, limit_order_address).await?;
        assert_eq!(
            limit_order_after.amount - limit_order_before.amount,
            amount,
            "Limit order amount increase mismatch! expected={}, got={}",
            amount,
            limit_order_after.amount - limit_order_before.amount
        );

        Ok(())
    }

    async fn verify_decrease_limit_order(
        ctx: &RpcContext,
        decrese_ix: &DecreaseLimitOrderInstruction,
        limit_order_mint: Pubkey,
        amount: u64,
        token_a_account: Pubkey,
        token_b_account: Pubkey,
    ) -> Result<(), Box<dyn Error>> {
        let limit_order_address = get_limit_order_address(&limit_order_mint)?.0;
        let limit_order_before = fetch_limit_order(&ctx.rpc, limit_order_address).await?;
        let before_a = get_token_balance(&ctx.rpc, token_a_account).await?;
        let before_b = get_token_balance(&ctx.rpc, token_b_account).await?;

        let signers: Vec<&Keypair> = decrese_ix.additional_signers.iter().collect();
        ctx.send_transaction_with_signers(decrese_ix.instructions.clone(), signers).await?;

        let after_a = get_token_balance(&ctx.rpc, token_a_account).await?;
        let after_b = get_token_balance(&ctx.rpc, token_b_account).await?;
        let used_a = after_a - before_a;
        let used_b = after_b - before_b;
        assert_eq!(
            used_a, decrese_ix.quote.amount_out_a,
            "Token A withdraw mismatch! expected={}, got={}",
            decrese_ix.quote.amount_out_a, used_a
        );
        assert_eq!(
            used_b, decrese_ix.quote.amount_out_b,
            "Token B withdraw mismatch! expected={}, got={}",
            decrese_ix.quote.amount_out_b, used_b
        );

        let limit_order_after = fetch_limit_order(&ctx.rpc, limit_order_address).await?;
        assert_eq!(
            limit_order_before.amount - limit_order_after.amount,
            amount,
            "Limit order amount decrease mismatch! expected={}, got={}",
            amount,
            limit_order_before.amount - limit_order_after.amount
        );

        Ok(())
    }

    async fn verify_close_limit_order(
        ctx: &RpcContext,
        close_ix: &DecreaseLimitOrderInstruction,
        token_a_account: Pubkey,
        token_b_account: Pubkey,
    ) -> Result<(), Box<dyn Error>> {
        let before_a = get_token_balance(&ctx.rpc, token_a_account).await?;
        let before_b = get_token_balance(&ctx.rpc, token_b_account).await?;

        let signers: Vec<&Keypair> = close_ix.additional_signers.iter().collect();
        ctx.send_transaction_with_signers(close_ix.instructions.clone(), signers).await?;

        let after_a = get_token_balance(&ctx.rpc, token_a_account).await?;
        let after_b = get_token_balance(&ctx.rpc, token_b_account).await?;
        let used_a = after_a - before_a;
        let used_b = after_b - before_b;
        assert_eq!(
            used_a, close_ix.quote.amount_out_a,
            "Token A withdraw mismatch! expected={}, got={}",
            close_ix.quote.amount_out_a, used_a
        );
        assert_eq!(
            used_b, close_ix.quote.amount_out_b,
            "Token B withdraw mismatch! expected={}, got={}",
            close_ix.quote.amount_out_b, used_b
        );

        Ok(())
    }

    async fn setup_all_mints(ctx: &RpcContext) -> Result<HashMap<&'static str, Pubkey>, Box<dyn Error>> {
        let mint_a = setup_mint_with_decimals(ctx, 9).await?;
        let mint_b = setup_mint_with_decimals(ctx, 9).await?;
        let mint_te_a = setup_mint_te(ctx, &[]).await?;
        let mint_te_b = setup_mint_te(ctx, &[]).await?;
        let mint_te_fee = setup_mint_te_fee(ctx).await?;

        let mut out = HashMap::new();
        out.insert("A", mint_a);
        out.insert("B", mint_b);
        out.insert("TEA", mint_te_a);
        out.insert("TEB", mint_te_b);
        out.insert("TEFee", mint_te_fee);

        Ok(out)
    }

    async fn setup_all_atas(ctx: &RpcContext, minted: &HashMap<&str, Pubkey>) -> Result<HashMap<&'static str, Pubkey>, Box<dyn Error>> {
        let token_balance = 1_000_000_000;
        let user_ata_a = setup_ata_with_amount(ctx, *minted.get("A").unwrap(), token_balance).await?;
        let user_ata_b = setup_ata_with_amount(ctx, *minted.get("B").unwrap(), token_balance).await?;
        let user_ata_te_a = setup_ata_te(ctx, *minted.get("TEA").unwrap(), Some(SetupAtaConfig { amount: Some(token_balance) })).await?;
        let user_ata_te_b = setup_ata_te(ctx, *minted.get("TEB").unwrap(), Some(SetupAtaConfig { amount: Some(token_balance) })).await?;
        let user_ata_tefee = setup_ata_te(ctx, *minted.get("TEFee").unwrap(), Some(SetupAtaConfig { amount: Some(token_balance) })).await?;

        let mut out = HashMap::new();
        out.insert("A", user_ata_a);
        out.insert("B", user_ata_b);
        out.insert("TEA", user_ata_te_a);
        out.insert("TEB", user_ata_te_b);
        out.insert("TEFee", user_ata_tefee);

        Ok(out)
    }

    pub fn parse_pool_name(pool_name: &str) -> (&'static str, &'static str) {
        match pool_name {
            "A-B" => ("A", "B"),
            "A-TEA" => ("A", "TEA"),
            "TEA-TEB" => ("TEA", "TEB"),
            "A-TEFee" => ("A", "TEFee"),
            _ => panic!("Unknown pool name: {}", pool_name),
        }
    }

    #[rstest]
    #[case("A-B", "input amount in A", 128, true)]
    #[case("A-B", "input amount in B", -128, false)]
    #[case("A-TEA", "input amount in A", 128, true)]
    #[case("A-TEA", "input amount in B", -128, false)]
    #[case("TEA-TEB", "input amount in A", 128, true)]
    #[case("TEA-TEB", "input amount in B", -128, false)]
    #[case("A-TEFee", "input amount in A", 128, true)]
    #[case("A-TEFee", "input amount in B", -128, false)]
    #[serial]
    fn test_open_increase_decrease_and_close_limit_order_cases(
        #[case] pool_name: &str,
        #[case] _limit_order_name: &str,
        #[case] tick_index: i32,
        #[case] a_to_b: bool,
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let ctx = RpcContext::new().await;

            let minted = setup_all_mints(&ctx).await.unwrap();
            let user_atas = setup_all_atas(&ctx, &minted).await.unwrap();

            let (mint_a_key, mint_b_key) = parse_pool_name(pool_name);
            let pubkey_a = *minted.get(mint_a_key).unwrap();
            let pubkey_b = *minted.get(mint_b_key).unwrap();

            let (final_a, final_b) = if pubkey_a < pubkey_b {
                (pubkey_a, pubkey_b)
            } else {
                (pubkey_b, pubkey_a)
            };

            // prevent flaky test by ordering the tokens correctly by lexical order
            let tick_spacing = 64;
            let fee_rate = 300;
            let swapped = pubkey_a > pubkey_b;
            let pool_pubkey = setup_fusion_pool(&ctx, final_a, final_b, tick_spacing, fee_rate).await.unwrap();
            let user_ata_for_token_a = if swapped {
                user_atas.get(mint_b_key).unwrap()
            } else {
                user_atas.get(mint_a_key).unwrap()
            };
            let user_ata_for_token_b = if swapped {
                user_atas.get(mint_a_key).unwrap()
            } else {
                user_atas.get(mint_b_key).unwrap()
            };

            let initial_amount = 2_000_000;
            let modify_amount = 1_000_000;

            // Open
            let open_ix = open_limit_order_instructions(
                &ctx.rpc,
                pool_pubkey,
                initial_amount,
                PriceOrTickIndex::Tick(tick_index),
                a_to_b,
                Some(ctx.signer.pubkey()),
            )
            .await
            .unwrap();
            verify_open_limit_order(&ctx, &open_ix, initial_amount, *user_ata_for_token_a, *user_ata_for_token_b)
                .await
                .unwrap();

            // Increase
            let increase_ix = increase_limit_order_instructions(&ctx.rpc, open_ix.limit_order_mint, modify_amount, Some(ctx.signer.pubkey()))
                .await
                .unwrap();
            verify_increase_limit_order(&ctx, &increase_ix, open_ix.limit_order_mint, modify_amount, *user_ata_for_token_a, *user_ata_for_token_b)
                .await
                .unwrap();

            // Partially decrease
            let decrease_ix = decrease_limit_order_instructions(&ctx.rpc, open_ix.limit_order_mint, modify_amount, Some(ctx.signer.pubkey()))
                .await
                .unwrap();
            verify_decrease_limit_order(&ctx, &decrease_ix, open_ix.limit_order_mint, modify_amount, *user_ata_for_token_a, *user_ata_for_token_b)
                .await
                .unwrap();

            // Decrease and close
            let close_ix = close_limit_order_instructions(&ctx.rpc, open_ix.limit_order_mint, Some(ctx.signer.pubkey()))
                .await
                .unwrap();
            verify_close_limit_order(&ctx, &close_ix, *user_ata_for_token_a, *user_ata_for_token_b)
                .await
                .unwrap();
        });
    }
}
