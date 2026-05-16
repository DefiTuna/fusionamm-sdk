import { fetchFusionPool, fetchMaybeLimitOrder, getLimitOrderAddress } from "@crypticdot/fusionamm-client";
import { closeLimitOrderInstructions, decreaseLimitOrderInstructions } from "@crypticdot/fusionamm-sdk";
import { sendTransaction } from "@crypticdot/fusionamm-tx-sender";
import { IInstruction } from "@solana/kit";
import { fetchAllMaybeToken, findAssociatedTokenPda } from "@solana-program/token-2022";
import { fetchAllMint } from "@solana-program/token-2022";

import BaseCommand, { addressArg, bigintArg } from "../base";
import { rpc, signer } from "../rpc";

export default class DecreaseLimitOrder extends BaseCommand {
  static override args = {
    limitOrderMint: addressArg({
      description: "Limit order mint address",
      required: true,
    }),
    shares: bigintArg({
      description: "The share by which the limit order needs to be reduced",
    }),
  };
  static override description = "Decrease the limit order. Fully close the limit order if shares are not provided.";
  static override examples = ["<%= config.bin %> <%= command.id %> LIMITORDERMINT 1000000"];

  public async run() {
    const { args } = await this.parse(DecreaseLimitOrder);

    console.log("Fetching accounts...");

    const limitOrderAddress = (await getLimitOrderAddress(args.limitOrderMint))[0];
    const limitOrder = await fetchMaybeLimitOrder(rpc, limitOrderAddress);
    if (!limitOrder.exists) {
      throw new Error(`Limit order doesn't exist at address ${args.limitOrderMint}`);
    }

    const fusionPool = await fetchFusionPool(rpc, limitOrder.data.fusionPool);
    const [mintA, mintB] = await fetchAllMint(rpc, [fusionPool.data.tokenMintA, fusionPool.data.tokenMintB]);

    const ownerAtaA = await findAssociatedTokenPda({
      owner: signer.address,
      mint: mintA.address,
      tokenProgram: mintA.programAddress,
    });
    const ownerAtaB = await findAssociatedTokenPda({
      owner: signer.address,
      mint: mintB.address,
      tokenProgram: mintB.programAddress,
    });

    const [tokenA, tokenB] = await fetchAllMaybeToken(rpc, [ownerAtaA[0], ownerAtaB[0]]);
    const balanceABefore = tokenA.exists ? tokenA.data.amount : 0n;
    const balanceBBefore = tokenB.exists ? tokenB.data.amount : 0n;

    const instructions: IInstruction[] = [];

    if (args.shares == undefined) {
      const closeInstructions = await closeLimitOrderInstructions(rpc, args.limitOrderMint, signer);
      instructions.push(...closeInstructions.instructions);
    } else {
      const decreaseInstructions = await decreaseLimitOrderInstructions(rpc, args.limitOrderMint, args.shares, signer);
      instructions.push(...decreaseInstructions.instructions);
    }

    console.log("Sending a transaction...");
    const signature = await sendTransaction(rpc, instructions, signer);
    console.log("Transaction landed:", signature);

    const [tokenAAfter, tokenBAfter] = await fetchAllMaybeToken(rpc, [ownerAtaA[0], ownerAtaB[0]]);
    const balanceAAfter = tokenAAfter.exists ? tokenAAfter.data.amount : 0n;
    const balanceBAfter = tokenBAfter.exists ? tokenBAfter.data.amount : 0n;

    if (balanceAAfter > balanceABefore) {
      console.log(`Received token A (${mintA.address}):`, balanceAAfter - balanceABefore);
    }
    if (balanceBAfter > balanceBBefore) {
      console.log(`Received token B (${mintB.address}):`, balanceBAfter - balanceBBefore);
    }
  }
}
