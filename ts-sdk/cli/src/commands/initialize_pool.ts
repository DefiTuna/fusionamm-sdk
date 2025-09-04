import {
  fetchMaybeFusionPool,
  getInitializePoolInstruction,
  getTokenBadgeAddress,
  getFusionPoolAddress,
  fetchMaybeFusionPoolsConfig,
  getFusionPoolsConfigAddress,
} from "@crypticdot/fusionamm-client";
import { priceToSqrtPrice, sqrtPriceToPrice } from "@crypticdot/fusionamm-core";
import { sendTransaction } from "@crypticdot/fusionamm-tx-sender";
import BaseCommand, { addressArg, priceArg } from "../base";
import { rpc, signer } from "../rpc";
import { Args } from "@oclif/core";
import { fetchMaybeMint } from "@solana-program/token-2022";
import { generateKeyPairSigner } from "@solana/kit";

export default class InitializePool extends BaseCommand {
  static override args = {
    tokenMintA: addressArg({
      description: "Token A mint address",
      required: true,
    }),
    tokenMintB: addressArg({
      description: "Token B mint address",
      required: true,
    }),
    tickSpacing: Args.integer({
      description: "Tick spacing",
      required: true,
      min: 1,
      max: 32768,
    }),
    feeRate: Args.integer({
      description: "Fee rate",
      required: true,
      min: 0,
      max: 60000,
    }),
    initialPrice: priceArg({
      description: "Initial price",
      required: true,
    }),
  };
  static override description = "Create a fusion amm pool";
  static override examples = [
    "<%= config.bin %> <%= command.id %> So11111111111111111111111111111111111111112 BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k 4 1000 50.0",
  ];

  public async run() {
    const { args } = await this.parse(InitializePool);

    const fusionPoolsConfigAddress = (await getFusionPoolsConfigAddress())[0];
    const mintAAddress = args.tokenMintA;
    const mintBAddress = args.tokenMintB;
    const tickSpacing = args.tickSpacing;
    const feeRate = args.feeRate;

    const fusionPoolsConfig = await fetchMaybeFusionPoolsConfig(rpc, fusionPoolsConfigAddress);
    if (!fusionPoolsConfig.exists) {
      throw new Error("FusionPoolsConfig account doesn't exist");
    }

    const mintA = await fetchMaybeMint(rpc, mintAAddress);
    if (!mintA.exists) {
      throw new Error("Token A mint account doesn't exist");
    }

    const mintB = await fetchMaybeMint(rpc, mintBAddress);
    if (!mintB.exists) {
      throw new Error("Token B mint account doesn't exist");
    }

    const fusionPoolAddress = (await getFusionPoolAddress(mintA.address, mintB.address, tickSpacing))[0];
    const tokenBadgeAAddress = (await getTokenBadgeAddress(mintA.address))[0];
    const tokenBadgeBAddress = (await getTokenBadgeAddress(mintB.address))[0];

    const initialSqrtPrice = priceToSqrtPrice(args.initialPrice, mintA.data.decimals, mintB.data.decimals);

    const fusionPool = await fetchMaybeFusionPool(rpc, fusionPoolAddress);
    if (fusionPool.exists) {
      console.log("FusionPool:", fusionPool);
      console.log(
        "Current pool price:",
        sqrtPriceToPrice(fusionPool.data.sqrtPrice, mintA.data.decimals, mintB.data.decimals),
      );
      throw new Error(`FusionAMM pool already exists at address ${fusionPoolAddress}`);
    }

    console.log(`Creating FusionAMM pool with tick spacing ${tickSpacing} at address ${fusionPoolAddress}`);

    const ix = getInitializePoolInstruction({
      funder: signer,
      fusionPoolsConfig: fusionPoolsConfigAddress,
      feeRate,
      initialSqrtPrice,
      tokenBadgeA: tokenBadgeAAddress,
      tokenBadgeB: tokenBadgeBAddress,
      tokenMintA: mintA.address,
      tokenMintB: mintB.address,
      tokenProgramA: mintA.programAddress,
      tokenProgramB: mintB.programAddress,
      tokenVaultA: await generateKeyPairSigner(),
      tokenVaultB: await generateKeyPairSigner(),
      fusionPool: fusionPoolAddress,
      tickSpacing,
    });

    console.log("Sending a transaction...");
    const signature = await sendTransaction(rpc, [ix], signer);
    console.log("Transaction landed:", signature);
  }
}
