import { fetchMaybePosition, getPositionAddress } from "@crypticdot/fusionamm-client";
import {
  closePositionInstructions,
  decreaseLiquidityInstructions,
  DecreaseLiquidityQuoteParam,
} from "@crypticdot/fusionamm-sdk";
import { sendTransaction } from "@crypticdot/fusionamm-tx-sender";
import { IInstruction } from "@solana/kit";

import BaseCommand, { addressArg, bigintFlag } from "../base";
import { rpc, signer } from "../rpc";

export default class DecreaseLiquidity extends BaseCommand {
  static override args = {
    positionMint: addressArg({
      description: "Position mint address",
      required: true,
    }),
  };
  static override flags = {
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
    "Removes liquidity from the position. Fully closes the position if amounts or liquidity are not provided.";
  static override examples = ["<%= config.bin %> <%= command.id %> POSITIONADDRESS"];

  public async run() {
    const { args, flags } = await this.parse(DecreaseLiquidity);

    console.log("Fetching accounts...");

    const positionAddress = (await getPositionAddress(args.positionMint))[0];
    const position = await fetchMaybePosition(rpc, positionAddress);
    if (!position.exists) {
      throw new Error(`Position doesn't exist at mint address ${args.positionMint}`);
    }

    const decreaseParams: DecreaseLiquidityQuoteParam = flags.liquidity
      ? {
          liquidity: flags.liquidity,
        }
      : flags.amountA
        ? { tokenA: flags.amountA }
        : { tokenB: flags.amountB! };

    const instructions: IInstruction[] = [];

    if (flags.liquidity === undefined && flags.amountA === undefined && flags.amountB === undefined) {
      const closeInstructions = await closePositionInstructions(
        rpc,
        args.positionMint,
        flags.slippageToleranceBps,
        signer,
      );
      instructions.push(...closeInstructions.instructions);

      console.log("Closing the position with mint address:", args.positionMint);
      console.log("Decrease quote:", closeInstructions.quote);
    } else {
      console.log("Decreasing liquidity of the position with mint address:", args.positionMint);

      const decreaseInstructions = await decreaseLiquidityInstructions(
        rpc,
        args.positionMint,
        decreaseParams,
        flags.slippageToleranceBps,
        signer,
      );
      instructions.push(...decreaseInstructions.instructions);

      console.log("Decrease quote:", decreaseInstructions.quote);
    }

    console.log("Sending a transaction...");
    const signature = await sendTransaction(rpc, instructions, signer);
    console.log("Transaction landed:", signature);
  }
}
