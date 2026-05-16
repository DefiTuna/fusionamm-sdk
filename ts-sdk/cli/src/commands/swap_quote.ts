import { fetchMaybeFusionPool, tickArrayToFacade } from "@crypticdot/fusionamm-client";
import {
  ExactInSwapQuote,
  ExactOutSwapQuote,
  sqrtPriceToPrice,
  swapQuoteByInputToken,
  swapQuoteByOutputToken,
} from "@crypticdot/fusionamm-core";
import { fetchTickArrayOrDefault, SLIPPAGE_TOLERANCE_BPS } from "@crypticdot/fusionamm-sdk";
import { Flags } from "@oclif/core";
import { fetchMint } from "@solana-program/token-2022";

import BaseCommand, { addressArg, bigintFlag } from "../base";
import { rpc } from "../rpc";

export default class SwapQuote extends BaseCommand {
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
  static override description = "Execute a swap quote.";
  static override examples = ["<%= config.bin %> <%= command.id %> POOLADDRESS --amountIn 1000000 --aToB"];

  public async run() {
    const { args, flags } = await this.parse(SwapQuote);

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

    console.log("Fetching accounts...");

    const fusionPool = await fetchMaybeFusionPool(rpc, args.pool);
    if (!fusionPool.exists) {
      throw new Error(`Fusion pool doesn't exist at address ${args.pool}`);
    }

    const mintA = await fetchMint(rpc, fusionPool.data.tokenMintA);
    const mintB = await fetchMint(rpc, fusionPool.data.tokenMintB);

    const currPrice = sqrtPriceToPrice(fusionPool.data.sqrtPrice, mintA.data.decimals, mintB.data.decimals);
    console.log("Current pool price:", currPrice);

    // Fetch 5 tick arrays around the current prices.
    const tickArrays = await fetchTickArrayOrDefault(rpc, fusionPool);

    const swapQuoteParams = [
      flags.amountIn ?? flags.amountOut!,
      aToB,
      SLIPPAGE_TOLERANCE_BPS,
      fusionPool.data,
      tickArrays.map(x => tickArrayToFacade(x.data)),
    ] as const;

    const swapQuote = flags.amountIn
      ? swapQuoteByInputToken(...swapQuoteParams)
      : swapQuoteByOutputToken(...swapQuoteParams);

    const swapQuoteAmount =
      flags.amountIn !== undefined
        ? (swapQuote as ExactInSwapQuote).tokenEstOut
        : (swapQuote as ExactOutSwapQuote).tokenEstIn;

    const nextPrice = sqrtPriceToPrice(swapQuote.nextSqrtPrice, mintA.data.decimals, mintB.data.decimals);
    console.log("Next pool price:", nextPrice);

    if (flags.amountIn !== undefined) {
      console.log("Output amount of the swap:", swapQuoteAmount);
    } else {
      console.log("Input amount required for the swap:", swapQuoteAmount);
    }

    const priceImpact = Math.abs(nextPrice / currPrice - 1) * 100;
    console.log(`Price impact: ${priceImpact.toLocaleString(undefined, { maximumFractionDigits: 3 })}%`);

    console.log(`Trade fee:`, swapQuote.tradeFee);
  }
}
