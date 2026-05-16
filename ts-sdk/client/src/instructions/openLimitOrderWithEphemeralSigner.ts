import { AccountRole, Address, address, IInstruction, TransactionSigner } from "@solana/kit";

import {
  FUSIONAMM_PROGRAM_ADDRESS,
  getOpenLimitOrderInstructionDataEncoder,
  OpenLimitOrderInstructionDataArgs,
} from "../generated";

export type OpenLimitOrderInputWithEphemeralSigner = {
  funder: TransactionSigner;
  owner: Address;
  limitOrder: Address;
  limitOrderMint: Address;
  limitOrderTokenAccount: Address;
  fusionPool: Address;
  token2022Program: Address;
  systemProgram?: Address;
  associatedTokenProgram: Address;
  metadataUpdateAuth: Address;
  tickIndex: OpenLimitOrderInstructionDataArgs["tickIndex"];
  aToB: OpenLimitOrderInstructionDataArgs["aToB"];
  withTokenMetadataExtension: OpenLimitOrderInstructionDataArgs["withTokenMetadataExtension"];
};

export function getOpenLimitOrderInstructionWithEphemeralSigner(
  input: OpenLimitOrderInputWithEphemeralSigner,
): IInstruction {
  const instruction: IInstruction = {
    accounts: [
      {
        address: input.funder.address,
        role: AccountRole.WRITABLE_SIGNER,
      },
      {
        address: input.owner,
        role: AccountRole.READONLY,
      },
      {
        address: input.limitOrder,
        role: AccountRole.WRITABLE,
      },
      {
        address: input.limitOrderMint,
        role: AccountRole.WRITABLE_SIGNER,
      },
      {
        address: input.limitOrderTokenAccount,
        role: AccountRole.WRITABLE,
      },
      {
        address: input.fusionPool,
        role: AccountRole.READONLY,
      },
      {
        address: input.token2022Program,
        role: AccountRole.READONLY,
      },
      {
        address: input.systemProgram ?? address("11111111111111111111111111111111"),
        role: AccountRole.READONLY,
      },
      {
        address: input.associatedTokenProgram,
        role: AccountRole.READONLY,
      },
      {
        address: input.metadataUpdateAuth,
        role: AccountRole.READONLY,
      },
    ],
    programAddress: FUSIONAMM_PROGRAM_ADDRESS,
    data: getOpenLimitOrderInstructionDataEncoder().encode(input as OpenLimitOrderInstructionDataArgs),
  };

  return instruction;
}
