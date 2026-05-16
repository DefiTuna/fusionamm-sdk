import { fetchMaybeFusionPool } from "@crypticdot/fusionamm-client";
import { sqrtPriceToPrice } from "@crypticdot/fusionamm-core";
import { increaseLimitOrderInstructions, openLimitOrderInstructions } from "@crypticdot/fusionamm-sdk";
import { sendTransaction } from "@crypticdot/fusionamm-tx-sender";
import { Flags } from "@oclif/core";
import { generateKeyPairSigner, IInstruction } from "@solana/kit";
import { fetchMint } from "@solana-program/token-2022";

import BaseCommand, { addressArg, addressFlag, bigintFlag, priceFlag } from "../base";
import { rpc, signer } from "../rpc";

export default class IncreaseLimitOrder extends BaseCommand {
  static override args = {
    pool: addressArg({
      description: "Fusion pool address",
      required: true,
    }),
  };
  static override flags = {
    limitOrderMint: addressFlag({
      description: "Limit order mint address. Required for an existing limit order.",
    }),

    amount: bigintFlag({
      description: "Provided amount of the input token",
      required: true,
    }),

    price: priceFlag({
      description: "Limit order price. Only required for a new order.",
    }),

    aToB: Flags.boolean({
      description: "Set the limit order A to B swap direction. Only required for a new order.",
    }),

    bToA: Flags.boolean({
      description: "Set the limit order B to A swap direction. Only required for a new order.",
    }),
  };
  static override description =
    "Add value to the limit order. Opens a new limit order if a limit mint account is not provided.";
  static override examples = ["<%= config.bin %> <%= command.id %> POOLADDRESS --price=5.0 --amount 1000000 --aToB"];

  public async run() {
    const { args, flags } = await this.parse(IncreaseLimitOrder);

    console.log("Fetching accounts...");

    const fusionPool = await fetchMaybeFusionPool(rpc, args.pool);
    if (!fusionPool.exists) {
      throw new Error(`Fusion pool doesn't exist at address ${args.pool}`);
    }

    const mintA = await fetchMint(rpc, fusionPool.data.tokenMintA);
    const mintB = await fetchMint(rpc, fusionPool.data.tokenMintB);

    console.log(
      "Current pool price:",
      sqrtPriceToPrice(fusionPool.data.sqrtPrice, mintA.data.decimals, mintB.data.decimals),
    );

    let limitOrderMint = flags.limitOrderMint;

    const instructions: IInstruction[] = [];

    if (limitOrderMint === undefined) {
      if (!flags.price) {
        throw new Error(`price must be specified`);
      }

      let aToB: boolean;
      if (flags.aToB !== undefined && flags.bToA !== undefined) {
        throw new Error("aToB and bToA flags can't be used together");
      } else if (flags.aToB) {
        aToB = true;
      } else if (flags.bToA) {
        aToB = false;
      } else {
        throw new Error("Swap direction flag must be set");
      }

      const limitOrderMintKeyPair = await generateKeyPairSigner();
      limitOrderMint = limitOrderMintKeyPair.address;

      const openInstructions = await openLimitOrderInstructions(
        rpc,
        limitOrderMintKeyPair,
        fusionPool.address,
        flags.amount!,
        { price: flags.price },
        aToB,
        signer,
      );
      instructions.push(...openInstructions.instructions);

      console.log("Opening a new limit order with mint address:", limitOrderMint);
      console.log("Limit order price:", flags.price);
      console.log("Limit order amount:", flags.amount);
    } else {
      if (flags.price !== undefined) {
        throw new Error(`price can't be specified if the limit order mint address is set`);
      }
      if (flags.aToB !== undefined || flags.bToA !== undefined) {
        throw new Error(`Swap direction can't be specified if the limit order mint address is set`);
      }

      console.log("Increasing the limit order at address:", limitOrderMint);

      const increaseInstructions = await increaseLimitOrderInstructions(rpc, limitOrderMint, flags.amount!, signer);
      instructions.push(...increaseInstructions.instructions);

      console.log("Increase amount:", flags.amount);
    }

    console.log("Sending a transaction...");
    const signature = await sendTransaction(rpc, instructions, signer);
    console.log("Transaction landed:", signature);
  }
}
