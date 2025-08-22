//
// Copyright (c) Cryptic Dot
//
// Licensed under FusionAMM SDK Source-Available License v1.0
// See the LICENSE file in the project root for license information.
//

use crate::jito::{get_jito_api_url_by_region, poll_jito_bundle_statuses, send_jito_bundle, JITO_TIP_ACCOUNTS, MIN_JITO_TIP_LAMPORTS};
use crate::priority_fee::get_priority_fee_estimate;
use crate::PriorityFeeLevel;
use log::warn;
use rand::Rng;
use reqwest::Client;
use solana_client::client_error::{ClientError, ClientErrorKind};
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_client::rpc_config::{RpcSendTransactionConfig, RpcSimulateTransactionConfig};
use solana_client::rpc_response::{Response, RpcSimulateTransactionResult};
use solana_commitment_config::{CommitmentConfig, CommitmentLevel};
use solana_compute_budget_interface::ComputeBudgetInstruction;
use solana_instruction::Instruction;
use solana_keypair::Keypair;
use solana_message::{v0, VersionedMessage};
use solana_program::address_lookup_table::AddressLookupTableAccount;
use solana_program::hash::Hash;
use solana_pubkey::Pubkey;
use solana_signature::Signature;
use solana_signer::SignerError;
use solana_system_interface::instruction::transfer;
use solana_transaction::versioned::VersionedTransaction;
use solana_transaction_error::TransactionError;
use solana_transaction_status::TransactionConfirmationStatus;
use std::fmt::{Display, Formatter};
use std::str::FromStr;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::time::sleep;

const MAX_COMPUTE_UNIT_LIMIT: u32 = 1_400_000;
const DEFAULT_TRANSACTION_TIMEOUT_SECONDS: u64 = 60;
const DEFAULT_POLLING_INTERVAL_SECONDS: u64 = 2;
const DEFAULT_COMPUTE_UNIT_MARGIN_MULTIPLIER: f64 = 1.15;

#[derive(Clone)]
pub struct SmartTxConfig {
    /// Priority fee options. Set to None if priority fees are not used.
    pub priority_fee: Option<SmartTxPriorityFeeConfig>,
    /// Jito options. Set to None if jito is not used.
    pub jito: Option<SmartTxJitoConfig>,
    /// This value is only used if estimation fails.
    pub default_compute_unit_limit: u32,
    /// Multiplier for CU estimation during simulation.
    pub compute_unit_margin_multiplier: f64,
    /// The simulation is skipped if set to true. Default value is false.
    pub disable_simulation: bool,
    /// Ignores simulation errors and sends the transaction anyway if set to true.
    pub ingore_simulation_error: bool,
    /// Specifies whether signature verification is required during the simulation.
    pub sig_verify_on_simulation: bool,
    /// Transaction confirmation polling interval. The default value is 2 seconds.
    pub polling_interval: Option<Duration>,
    /// The default timeout is 60 seconds.
    pub transaction_timeout: Option<Duration>,
    /// The blockhash to use for the transaction. If set to None, the recent one will be fetched.
    pub blockhash: Option<Hash>,
}

impl Default for SmartTxConfig {
    fn default() -> Self {
        Self {
            priority_fee: None,
            jito: None,
            default_compute_unit_limit: MAX_COMPUTE_UNIT_LIMIT,
            compute_unit_margin_multiplier: DEFAULT_COMPUTE_UNIT_MARGIN_MULTIPLIER,
            disable_simulation: false,
            ingore_simulation_error: false,
            sig_verify_on_simulation: true,
            polling_interval: None,
            transaction_timeout: None,
            blockhash: None,
        }
    }
}

#[derive(Clone)]
pub struct SmartTxPriorityFeeConfig {
    pub fee_level: PriorityFeeLevel,
    pub fee_min: Option<u64>,
    pub fee_max: Option<u64>,
}

#[derive(Clone)]
pub struct SmartTxJitoConfig {
    pub uuid: String,
    pub tips: u64,
    pub region: Option<String>,
}

#[derive(Clone, Default)]
pub struct SmartTxElapsedTime {
    /// Elapsed time since when `send_smart_transaction()` is called until the simulation finishes.
    pub prepare_and_simulate: Duration,
    /// Elapsed time since when `send_smart_transaction()` is called until the tx send request returns a result.
    pub send: Duration,
    /// Elapsed time since when `send_smart_transaction()` is called until the tx is confirmed.
    pub confirm: Duration,
}

impl Display for SmartTxElapsedTime {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "sim/send/confirm: {}/{}/{} ms",
            self.prepare_and_simulate.as_millis(),
            self.send.as_millis(),
            self.confirm.as_millis()
        )
    }
}

#[derive(Clone)]
pub struct SmartTxResult {
    /// The transaction signature.
    pub signature: String,
    /// Used priority fee (micro lamports per compute unit).
    pub priority_fee: u64,
    /// Jito bundle id if the transaction has been sent via Jito.
    pub jito_bundle_id: Option<String>,
    /// Various elapsed times for statistical purposes.
    pub elapsed_time: SmartTxElapsedTime,
}

#[allow(clippy::enum_variant_names)]
#[allow(clippy::large_enum_variant)]
#[derive(thiserror::Error, Debug)]
pub enum SmartTransactionError {
    #[error(transparent)]
    CompileError(#[from] solana_program::message::CompileError),
    #[error(transparent)]
    SigningError(#[from] SignerError),
    #[error(transparent)]
    SimulationError(#[from] TransactionError),
    #[error(transparent)]
    RpcClientError(#[from] ClientError),
    #[error("JitoClientError: {0}")]
    JitoClientError(String),
}

pub async fn send_smart_transaction(
    client: &RpcClient,
    signers: Vec<Arc<Keypair>>,
    payer: &Pubkey,
    instructions: Vec<Instruction>,
    lookup_tables: Vec<AddressLookupTableAccount>,
    tx_config: SmartTxConfig,
) -> Result<SmartTxResult, SmartTransactionError> {
    let start = Instant::now();
    let mut elapsed_time = SmartTxElapsedTime::default();

    let transaction_timeout = tx_config
        .transaction_timeout
        .unwrap_or_else(|| Duration::from_secs(DEFAULT_TRANSACTION_TIMEOUT_SECONDS));
    let polling_interval = tx_config
        .polling_interval
        .unwrap_or_else(|| Duration::from_secs(DEFAULT_POLLING_INTERVAL_SECONDS));

    let mut priority_fee = 0;
    if let Some(fee_config) = tx_config.priority_fee {
        // Priority fee is not required for jito bundles.
        if tx_config.jito.is_none() && fee_config.fee_level != PriorityFeeLevel::None {
            priority_fee = if let PriorityFeeLevel::Custom(fee) = fee_config.fee_level {
                fee
            } else {
                let mut accounts: Vec<Pubkey> = instructions.iter().flat_map(|ix| ix.accounts.iter()).map(|a| a.pubkey).collect();
                let programs: Vec<Pubkey> = instructions.iter().map(|ix| ix.program_id).collect();
                accounts.extend(programs);

                get_priority_fee_estimate(client, accounts, fee_config.fee_level).await?
            };

            if let Some(fee_min) = fee_config.fee_min {
                priority_fee = priority_fee.max(fee_min);
            }
            if let Some(fee_max) = fee_config.fee_max {
                priority_fee = priority_fee.min(fee_max);
            }
        }
    }

    let mut all_instructions = Vec::<Instruction>::new();

    if priority_fee > 0 {
        all_instructions.push(ComputeBudgetInstruction::set_compute_unit_price(priority_fee));
    }

    all_instructions.extend(instructions);

    // Add a tip instruction to the end of the instructions list if jito tips are provided.
    if let Some(jito_config) = tx_config.jito.clone() {
        let rnd = rand::rng().random_range(0..JITO_TIP_ACCOUNTS.len());
        let tip_amount = jito_config.tips.max(MIN_JITO_TIP_LAMPORTS);
        let random_tip_account = Pubkey::from_str(JITO_TIP_ACCOUNTS[rnd]).unwrap();
        let tip_instruction = transfer(payer, &random_tip_account, tip_amount);
        all_instructions.push(tip_instruction);
    }

    let signers_copy: Vec<Keypair> = signers.iter().map(|keypair| keypair.insecure_clone()).collect();

    // Simulate transaction and estimate CU usage. A simulation may fail, so do it a few times.
    let mut cu_limit = 0;
    if !tx_config.disable_simulation {
        for _ in 0..5 {
            match simulate_transaction(
                client,
                &all_instructions,
                payer,
                &signers_copy,
                lookup_tables.clone(),
                tx_config.blockhash,
                tx_config.sig_verify_on_simulation,
            )
            .await
            {
                Ok(response) => {
                    if let Some(err) = response.value.err {
                        match err.clone() {
                            TransactionError::BlockhashNotFound => continue,
                            err => {
                                if !tx_config.ingore_simulation_error {
                                    return Err(err.into());
                                } else {
                                    warn!(target: "log", "Simulation failed with error: {:?}", err);
                                    break;
                                }
                            }
                        }
                    }

                    let cu_consumed = response.value.units_consumed.unwrap_or(0);

                    // Add margin to the consumed compute units during the simulation.
                    cu_limit =
                        u32::min(MAX_COMPUTE_UNIT_LIMIT, (cu_consumed as f64 * tx_config.compute_unit_margin_multiplier.clamp(1.0, 10.0)) as u32);
                    break;
                }
                Err(_) => {
                    //warn!(target: "log", "Simulation failed with error: {:?}", err);
                    continue;
                }
            };
        }

        if cu_limit == 0 {
            cu_limit = tx_config.default_compute_unit_limit;
            if cu_limit > 0 {
                warn!(target: "log", "Simulation failed; setting the CU limit to the default value of {}", cu_limit);
            } else {
                warn!(target: "log", "Simulation failed; setting the CU limit to the default value");
            }
        };
    } else {
        cu_limit = tx_config.default_compute_unit_limit;
    }

    if cu_limit > 0 {
        all_instructions.insert(0, ComputeBudgetInstruction::set_compute_unit_limit(cu_limit));
    }

    //
    // Recreate the transaction with the updated CU limit.
    //
    let latest_blockhash = if let Some(blockhash) = tx_config.blockhash {
        blockhash
    } else {
        client.get_latest_blockhash().await?
    };

    let versioned_message = VersionedMessage::V0(v0::Message::try_compile(payer, &all_instructions, &lookup_tables, latest_blockhash)?);
    let transaction = VersionedTransaction::try_new(versioned_message, &signers_copy)?;

    elapsed_time.prepare_and_simulate = start.elapsed();

    if let Some(jito_config) = tx_config.jito {
        let serialized_transaction = bincode::serialize(&transaction).expect("Failed to serialize transaction");
        let transaction_base58 = bs58::encode(&serialized_transaction).into_string();

        let user_provided_region = jito_config.region.unwrap_or("Default".to_string());
        let jito_api_base_url = get_jito_api_url_by_region(&user_provided_region);
        let jito_api_url = if jito_config.uuid.is_empty() {
            format!("{}/api/v1/bundles", jito_api_base_url)
        } else {
            format!("{}/api/v1/bundles?uuid={}", jito_api_base_url, jito_config.uuid)
        };

        // Send the transaction as Jito bundle.
        let jito_client = Client::new();
        let jito_bundle_id = send_jito_bundle(jito_client.clone(), vec![transaction_base58], &jito_api_url)
            .await
            .map_err(|e| SmartTransactionError::JitoClientError(e.to_string()))?;

        elapsed_time.send = start.elapsed();

        // Wait for the confirmation.
        let signature = poll_jito_bundle_statuses(jito_client.clone(), jito_bundle_id.clone(), &jito_api_url, polling_interval, transaction_timeout)
            .await
            .map_err(|e| SmartTransactionError::JitoClientError(e.to_string()))?;

        elapsed_time.confirm = start.elapsed();

        Ok(SmartTxResult {
            signature,
            priority_fee,
            jito_bundle_id: Some(jito_bundle_id),
            elapsed_time,
        })
    } else {
        let send_config = RpcSendTransactionConfig {
            skip_preflight: true,
            preflight_commitment: Some(CommitmentLevel::Confirmed),
            max_retries: Some(0),
            ..RpcSendTransactionConfig::default()
        };

        // Send the transaction.
        let signature = client.send_transaction_with_config(&transaction, send_config).await?;

        elapsed_time.send = start.elapsed();

        // Wait for the confirmation.
        poll_transaction_confirmation(client, signature, polling_interval, transaction_timeout).await?;

        elapsed_time.confirm = start.elapsed();

        Ok(SmartTxResult {
            signature: signature.to_string(),
            priority_fee,
            jito_bundle_id: None,
            elapsed_time,
        })
    }
}

#[allow(clippy::result_large_err)]
async fn simulate_transaction(
    client: &RpcClient,
    instructions: &[Instruction],
    payer: &Pubkey,
    signers: &[Keypair],
    lookup_tables: Vec<AddressLookupTableAccount>,
    latest_blockhash: Option<Hash>,
    sig_verify: bool,
) -> Result<Response<RpcSimulateTransactionResult>, SmartTransactionError> {
    // Set the compute budget limit
    let mut test_instructions = vec![ComputeBudgetInstruction::set_compute_unit_limit(MAX_COMPUTE_UNIT_LIMIT)];
    test_instructions.extend(instructions.to_vec());

    // Fetch the latest blockhash
    let recent_blockhash = if sig_verify {
        latest_blockhash.unwrap_or(client.get_latest_blockhash().await?)
    } else {
        Hash::default()
    };

    let versioned_message = VersionedMessage::V0(v0::Message::try_compile(payer, &test_instructions, &lookup_tables, recent_blockhash)?);
    let transaction = VersionedTransaction::try_new(versioned_message, signers)?;

    let simulate_config = RpcSimulateTransactionConfig {
        sig_verify,
        replace_recent_blockhash: !sig_verify,
        commitment: Some(CommitmentConfig::confirmed()),
        encoding: None,
        accounts: None,
        min_context_slot: None,
        inner_instructions: false,
    };

    let result = client.simulate_transaction_with_config(&transaction, simulate_config).await?;
    Ok(result)
}

/// Poll a transaction to check whether it has been confirmed
///
/// * `txt-sig` - The transaction signature to check
///
/// # Returns
/// The confirmed transaction signature or an error if the confirmation times out
async fn poll_transaction_confirmation(
    client: &RpcClient,
    tx_sig: Signature,
    interval: Duration,
    timeout: Duration,
) -> Result<Signature, ClientError> {
    let start = Instant::now();

    loop {
        sleep(interval).await;

        let status = client.get_signature_statuses(&[tx_sig]).await?;

        if let Some(status) = status.value[0].clone() {
            if status.err.is_none()
                && (status.confirmation_status == Some(TransactionConfirmationStatus::Confirmed)
                    || status.confirmation_status == Some(TransactionConfirmationStatus::Finalized))
            {
                return Ok(tx_sig);
            }
            if status.err.is_some() {
                warn!(target: "log", "Transaction {} failed with error: {}", tx_sig, status.err.clone().unwrap());
                return Err(ClientError {
                    request: None,
                    kind: status.err.unwrap().into(),
                });
            }
        }

        if start.elapsed() > timeout {
            break;
        }
    }

    Err(ClientError {
        request: None,
        kind: ClientErrorKind::Custom(format!("Unable to confirm transaction {} in {} seconds", tx_sig, timeout.as_secs())),
    })
}
