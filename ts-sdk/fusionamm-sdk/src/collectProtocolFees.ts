import {
  fetchFusionPool,
  getCollectProtocolFeesInstruction,
  getFusionPoolsConfigAddress,
} from "@crypticdot/fusionamm-client";
import {
  Address,
  GetAccountInfoApi,
  GetEpochInfoApi,
  GetMinimumBalanceForRentExemptionApi,
  GetMultipleAccountsApi,
  type IInstruction,
  Rpc,
  TransactionSigner,
} from "@solana/kit";
import { MEMO_PROGRAM_ADDRESS } from "@solana-program/memo";
import { fetchAllMint } from "@solana-program/token-2022";

import { FUNDER } from "./config";
import { prepareTokenAccountsInstructions } from "./token";

export async function collectProtocolFeesInstructions(
  rpc: Rpc<GetAccountInfoApi & GetMultipleAccountsApi & GetMinimumBalanceForRentExemptionApi & GetEpochInfoApi>,
  poolAddress: Address,
  funder: TransactionSigner = FUNDER,
): Promise<IInstruction[]> {
  const instructions: IInstruction[] = [];

  const fusionPoolsConfig = (await getFusionPoolsConfigAddress())[0];

  const fusionPool = await fetchFusionPool(rpc, poolAddress);

  const [mintA, mintB] = await fetchAllMint(rpc, [fusionPool.data.tokenMintA, fusionPool.data.tokenMintB]);

  const { createInstructions, cleanupInstructions, tokenAccountAddresses } = await prepareTokenAccountsInstructions(
    rpc,
    funder,
    [fusionPool.data.tokenMintA, fusionPool.data.tokenMintB],
  );
  instructions.push(...createInstructions);

  const ix = getCollectProtocolFeesInstruction({
    collectProtocolFeesAuthority: funder,
    tokenDestinationA: tokenAccountAddresses[mintA.address],
    tokenDestinationB: tokenAccountAddresses[mintB.address],
    tokenMintA: mintA.address,
    tokenMintB: mintB.address,
    tokenProgramA: mintA.programAddress,
    tokenProgramB: mintB.programAddress,
    tokenVaultA: fusionPool.data.tokenVaultA,
    tokenVaultB: fusionPool.data.tokenVaultB,
    fusionPool: poolAddress,
    fusionPoolsConfig,
    memoProgram: MEMO_PROGRAM_ADDRESS,
    remainingAccountsInfo: null,
  });
  instructions.push(ix);
  instructions.push(...cleanupInstructions);

  return instructions;
}
