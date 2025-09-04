import {
  fetchMaybeFusionPool,
  getFusionPoolsConfigAddress,
  getResetPoolPriceInstruction,
} from "@crypticdot/fusionamm-client";
import { priceToSqrtPrice, sqrtPriceToPrice } from "@crypticdot/fusionamm-core";
import { sendTransaction } from "@crypticdot/fusionamm-tx-sender";
import BaseCommand, { addressArg, priceArg } from "../base";
import { rpc, signer } from "../rpc";
import { fetchAllMint } from "@solana-program/token-2022";

export default class ResetPoolPrice extends BaseCommand {
  static override args = {
    pool: addressArg({
      description: "Fusion pool address",
      required: true,
    }),
    price: priceArg({
      description: "New pool price",
    }),
  };
  static override description = "Reset the price of an empty fusion pool";
  static override examples = ["<%= config.bin %> <%= command.id %> BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k 50.0"];

  public async run() {
    const { args } = await this.parse(ResetPoolPrice);

    console.log(`Fetching fusion pool at address ${args.pool}...`);
    const fusionPool = await fetchMaybeFusionPool(rpc, args.pool);
    if (fusionPool.exists) {
      console.log("Fusion pool:", fusionPool);
    } else {
      throw new Error(`Fusion pool is not found at address ${args.pool}`);
    }

    const [mintA, mintB] = await fetchAllMint(rpc, [fusionPool.data.tokenMintA, fusionPool.data.tokenMintB]);
    console.log(
      "Current pool price:",
      sqrtPriceToPrice(fusionPool.data.sqrtPrice, mintA.data.decimals, mintB.data.decimals),
    );

    if (!args.price) {
      throw new Error("The pool price argument is not provided");
    }

    const sqrtPrice = priceToSqrtPrice(args.price, mintA.data.decimals, mintB.data.decimals);
    console.log("New pool price:", args.price);

    const fusionPoolsConfig = (await getFusionPoolsConfigAddress())[0];
    const ix = getResetPoolPriceInstruction({
      fusionPoolsConfig,
      tokenVaultA: fusionPool.data.tokenVaultA,
      tokenVaultB: fusionPool.data.tokenVaultB,
      feeAuthority: signer,
      fusionPool: fusionPool.address,
      sqrtPrice,
    });

    console.log("Sending a transaction...");
    const signature = await sendTransaction(rpc, [ix], signer);
    console.log("Transaction landed:", signature);
  }
}
