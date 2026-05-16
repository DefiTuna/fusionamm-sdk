//
// Copyright (c) Cryptic Dot
//
// Modification based on Orca Whirlpools (https://github.com/orca-so/whirlpools),
// originally licensed under the Apache License, Version 2.0, prior to February 26, 2025.
//
// Modifications licensed under FusionAMM SDK Source-Available License v1.0
// See the LICENSE file in the project root for license information.
//

import type { Address, IInstruction } from "@solana/kit";
import { getCreateAccountInstruction, getTransferSolInstruction } from "@solana-program/system";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getInitializeMint2Instruction,
  getMintSize,
  getMintToInstruction,
  getSyncNativeInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";

import { NATIVE_MINT } from "../../src/token";

import { getNextKeypair } from "./keypair";
import { sendTransaction, signer } from "./mockRpc";

export async function setupAta(mint: Address, config: { amount?: number | bigint } = {}): Promise<Address> {
  const ata = await findAssociatedTokenPda({
    mint,
    owner: signer.address,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });

  const instructions: IInstruction[] = [];

  instructions.push(
    getCreateAssociatedTokenIdempotentInstruction({
      mint,
      owner: signer.address,
      ata: ata[0],
      payer: signer,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    }),
  );

  if (config.amount) {
    if (mint === NATIVE_MINT) {
      instructions.push(
        getTransferSolInstruction({
          source: signer,
          destination: ata[0],
          amount: config.amount,
        }),
      );
      instructions.push(
        getSyncNativeInstruction({
          account: ata[0],
        }),
      );
    } else {
      instructions.push(
        getMintToInstruction({
          mint,
          token: ata[0],
          mintAuthority: signer,
          amount: config.amount,
        }),
      );
    }
  }

  await sendTransaction(instructions);

  return ata[0];
}

export async function setupMint(config: { decimals?: number } = {}): Promise<Address> {
  const keypair = getNextKeypair();
  const instructions: IInstruction[] = [];

  instructions.push(
    getCreateAccountInstruction({
      payer: signer,
      newAccount: keypair,
      lamports: 1e8,
      space: getMintSize(),
      programAddress: TOKEN_PROGRAM_ADDRESS,
    }),
  );

  instructions.push(
    getInitializeMint2Instruction({
      mint: keypair.address,
      mintAuthority: signer.address,
      freezeAuthority: null,
      decimals: config.decimals ?? 6,
    }),
  );

  await sendTransaction(instructions);

  return keypair.address;
}
