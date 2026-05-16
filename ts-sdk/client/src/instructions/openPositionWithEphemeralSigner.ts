import { AccountRole, Address, address, IInstruction, TransactionSigner } from "@solana/kit";

import {
  FUSIONAMM_PROGRAM_ADDRESS,
  getOpenPositionInstructionDataEncoder,
  OpenPositionInstructionDataArgs,
} from "../generated";

export type OpenPositionInputWithEphemeralSigner = {
  funder: TransactionSigner;
  owner: Address;
  position: Address;
  positionMint: Address;
  positionTokenAccount: Address;
  fusionPool: Address;
  token2022Program: Address;
  systemProgram?: Address;
  associatedTokenProgram: Address;
  metadataUpdateAuth: Address;
  tickLowerIndex: OpenPositionInstructionDataArgs["tickLowerIndex"];
  tickUpperIndex: OpenPositionInstructionDataArgs["tickUpperIndex"];
  withTokenMetadataExtension: OpenPositionInstructionDataArgs["withTokenMetadataExtension"];
};

export function getOpenPositionInstructionWithEphemeralSigner(
  input: OpenPositionInputWithEphemeralSigner,
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
        address: input.position,
        role: AccountRole.WRITABLE,
      },
      {
        address: input.positionMint,
        role: AccountRole.WRITABLE_SIGNER,
      },
      {
        address: input.positionTokenAccount,
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
    data: getOpenPositionInstructionDataEncoder().encode(input as OpenPositionInstructionDataArgs),
  };

  return instruction;
}
