import { fetchMaybeFusionPool } from "@crypticdot/fusionamm-client";
import { sqrtPriceToPrice } from "@crypticdot/fusionamm-core";
import {
  increaseLiquidityInstructions,
  IncreaseLiquidityQuoteParam,
  openPositionInstructions,
} from "@crypticdot/fusionamm-sdk";
import { sendTransaction } from "@crypticdot/fusionamm-tx-sender";
import { Flags } from "@oclif/core";
import { generateKeyPairSigner, IInstruction } from "@solana/kit";
import { fetchAllMint } from "@solana-program/token-2022";

import BaseCommand, { addressArg, addressFlag, bigintFlag, priceFlag } from "../base";
import { rpc, signer } from "../rpc";

export default class IncreaseLiquidity extends BaseCommand {
  static override args = {
    pool: addressArg({
      description: "Fusion pool address",
      required: true,
    }),
  };
  static override flags = {
    positionMint: addressFlag({
      description: "Position mint address. Required for an existing position.",
    }),
    lowerPrice: priceFlag({
      description: "Lower price. Only required for a new position",
    }),
    upperPrice: priceFlag({
      description: "Upper price. Only required for a new position",
    }),
    slippageToleranceBps: Flags.integer({
      description: "Slippage Tolerance Bps",
      min: 0,
      max: 65535,
    }),
    amountA: bigintFlag({
      description: "Provided amount of token A",
    }),
    amountB: bigintFlag({
      description: "Provided amount of token B",
    }),
    liquidity: bigintFlag({
      description: "Provided liquidity",
    }),
  };
  static override description =
    "Add liquidity to the position. Opens a new position if a position mint account is not provided.";
  static override examples = [
    "<%= config.bin %> <%= command.id %> POOLADDRESS --lowerPrice=5.0 --upperPrice=300.0 --amountA 1000000",
  ];

  public async run() {
    const { args, flags } = await this.parse(IncreaseLiquidity);

    console.log("Fetching accounts...");

    const fusionPool = await fetchMaybeFusionPool(rpc, args.pool);
    if (!fusionPool.exists) {
      throw new Error(`Fusion pool doesn't exist at address ${args.pool}`);
    }

    const [mintA, mintB] = await fetchAllMint(rpc, [fusionPool.data.tokenMintA, fusionPool.data.tokenMintB]);

    console.log("FusionPool:", fusionPool);
    console.log(
      "Current pool price:",
      sqrtPriceToPrice(fusionPool.data.sqrtPrice, mintA.data.decimals, mintB.data.decimals),
    );

    if ([flags.liquidity, flags.amountA, flags.amountB].filter(v => v !== undefined).length !== 1) {
      throw new Error("Exactly one of the following parameters must be provided: liquidity, amountA, or amountB");
    }

    const increaseParam: IncreaseLiquidityQuoteParam = flags.liquidity
      ? {
          liquidity: flags.liquidity,
        }
      : flags.amountA
        ? { tokenA: flags.amountA }
        : { tokenB: flags.amountB! };

    let positionMint = flags.positionMint;

    const instructions: IInstruction[] = [];

    if (positionMint === undefined) {
      if (!flags.lowerPrice) {
        throw new Error(`lowerPrice must be specified`);
      }

      if (!flags.upperPrice) {
        throw new Error(`upperPrice must be specified`);
      }

      const positionMintKeyPair = await generateKeyPairSigner();
      positionMint = positionMintKeyPair.address;

      const openInstructions = await openPositionInstructions(
        rpc,
        positionMintKeyPair,
        fusionPool.address,
        increaseParam,
        { price: flags.lowerPrice },
        { price: flags.upperPrice },
        flags.slippageToleranceBps,
        signer,
      );
      instructions.push(...openInstructions.instructions);

      positionMint = openInstructions.positionMint;
      console.log("Opening a new position with mint address:", positionMint);
      console.log("Increase quote:", openInstructions.quote);
    } else {
      if (flags.lowerPrice !== undefined || flags.upperPrice !== undefined) {
        throw new Error(`lowerPrice and upperPrice can't be specified if the position mint address is set`);
      }

      console.log("Increasing liquidity of the position at address:", positionMint);

      const increaseInstructions = await increaseLiquidityInstructions(
        rpc,
        positionMint,
        increaseParam,
        flags.slippageToleranceBps,
        signer,
      );
      instructions.push(...increaseInstructions.instructions);

      console.log("Increase quote:", increaseInstructions.quote);
    }

    console.log("Sending a transaction...");
    const signature = await sendTransaction(rpc, instructions, signer);
    console.log("Transaction landed:", signature);
  }
}
