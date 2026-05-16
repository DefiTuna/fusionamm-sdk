import { fetchFusionPool, fetchMaybeFusionPool } from "@crypticdot/fusionamm-client";
import { sqrtPriceToPrice } from "@crypticdot/fusionamm-core";
import { SLIPPAGE_TOLERANCE_BPS, swapInstructions } from "@crypticdot/fusionamm-sdk";
import { sendTransaction } from "@crypticdot/fusionamm-tx-sender";
import { Flags } from "@oclif/core";
import { IInstruction } from "@solana/kit";
import { fetchMint } from "@solana-program/token-2022";

import BaseCommand, { addressArg, bigintFlag } from "../base";
import { rpc, signer } from "../rpc";

export default class Swap extends BaseCommand {
  static override args = {
    pool: addressArg({
      description: "Fusion pool address",
      required: true,
    }),
  };
  static override flags = {
    amountIn: bigintFlag({
      description: "Input amount of the swap",
    }),
    amountOut: bigintFlag({
      description: "Output amount of the swap",
    }),
    aToB: Flags.boolean({
      description: "Swap A to B",
    }),
    bToA: Flags.boolean({
      description: "Swap B to A",
    }),
  };
  static override description = "Execute a swap.";
  static override examples = ["<%= config.bin %> <%= command.id %> POOLADDRESS --amountIn 1000000 --aToB"];

  public async run() {
    const { args, flags } = await this.parse(Swap);

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

    const instructions: IInstruction[] = [];

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

    if (flags.amountIn == undefined && flags.amountOut == undefined) {
      throw new Error("amountIn or amountOut must be set");
    }

    try {
      if (flags.amountIn) {
        const openInstructions = await swapInstructions(
          rpc,
          {
            inputAmount: flags.amountIn,
            mint: aToB ? fusionPool.data.tokenMintA : fusionPool.data.tokenMintB,
          },
          fusionPool.address,
          SLIPPAGE_TOLERANCE_BPS * 100, // 100%
          signer,
        );
        instructions.push(...openInstructions.instructions);
      } else if (flags.amountOut) {
        const openInstructions = await swapInstructions(
          rpc,
          {
            outputAmount: flags.amountOut,
            mint: aToB ? fusionPool.data.tokenMintB : fusionPool.data.tokenMintA,
          },
          fusionPool.address,
          SLIPPAGE_TOLERANCE_BPS * 100, // 100%
          signer,
        );
        instructions.push(...openInstructions.instructions);
      }
    } catch (e) {
      if (typeof e == "string") {
        throw new Error(e as string);
      }
      throw e;
    }

    console.log("Sending a transaction...");
    const signature = await sendTransaction(rpc, instructions, signer);
    console.log("Transaction landed:", signature);

    const fusionPoolAfterSwap = await fetchFusionPool(rpc, args.pool);
    console.log(
      "Pool price after swap:",
      sqrtPriceToPrice(fusionPoolAfterSwap.data.sqrtPrice, mintA.data.decimals, mintB.data.decimals),
    );
  }
}
