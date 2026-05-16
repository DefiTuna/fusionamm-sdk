import {
  fetchFusionPool,
  fetchPosition,
  getLockPositionInstruction,
  getPositionAddress,
  getPositionLockAddress,
  PositionLockType,
} from "@crypticdot/fusionamm-client";
import {
  Address,
  GetAccountInfoApi,
  GetEpochInfoApi,
  GetMinimumBalanceForRentExemptionApi,
  GetMultipleAccountsApi,
  IInstruction,
  Rpc,
  TransactionSigner,
} from "@solana/kit";
import { findAssociatedTokenPda } from "@solana-program/token";
import { TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";

import { FUNDER } from "./config.ts";

/**
 * Generates instruction to lock a position.
 */
export async function lockPositionInstruction(
  rpc: Rpc<GetAccountInfoApi & GetMultipleAccountsApi & GetMinimumBalanceForRentExemptionApi & GetEpochInfoApi>,
  positionMintAddress: Address,
  lockType: PositionLockType,
  authority: TransactionSigner = FUNDER,
): Promise<IInstruction> {
  const positionLockAddress = (await getPositionLockAddress(positionMintAddress))[0];

  const positionAddress = (await getPositionAddress(positionMintAddress))[0];
  const position = await fetchPosition(rpc, positionAddress);
  const fusionPool = await fetchFusionPool(rpc, position.data.fusionPool);

  const positionTokenAccount = (
    await findAssociatedTokenPda({
      owner: authority.address,
      mint: positionMintAddress,
      tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    })
  )[0];

  return getLockPositionInstruction({
    funder: authority,
    positionAuthority: authority,
    position: positionAddress,
    positionMint: positionMintAddress,
    positionTokenAccount: positionTokenAccount,
    positionLock: positionLockAddress,
    fusionPool: fusionPool.address,
    token2022Program: TOKEN_2022_PROGRAM_ADDRESS,
    lockType,
  });
}
