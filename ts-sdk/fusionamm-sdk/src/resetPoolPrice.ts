import {
  fetchFusionPool,
  getFusionPoolsConfigAddress,
  getResetPoolPriceInstruction,
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

import { FUNDER } from "./config";

export async function resetPoolPriceInstruction(
  rpc: Rpc<GetAccountInfoApi & GetMultipleAccountsApi & GetMinimumBalanceForRentExemptionApi & GetEpochInfoApi>,
  poolAddress: Address,
  sqrtPrice: bigint,
  authority: TransactionSigner = FUNDER,
): Promise<IInstruction> {
  const fusionPoolsConfig = (await getFusionPoolsConfigAddress())[0];
  const fusionPool = await fetchFusionPool(rpc, poolAddress);

  return getResetPoolPriceInstruction({
    fusionPoolsConfig,
    tokenVaultA: fusionPool.data.tokenVaultA,
    tokenVaultB: fusionPool.data.tokenVaultB,
    feeAuthority: authority,
    fusionPool: poolAddress,
    sqrtPrice,
  });
}
