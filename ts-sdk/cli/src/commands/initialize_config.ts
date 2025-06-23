import { sendTransaction } from "@crypticdot/fusionamm-tx-sender";
import { getFusionPoolsConfigAddress, getInitializeConfigInstruction } from "@crypticdot/fusionamm-client";
import BaseCommand, { addressArg, addressFlag } from "../base";
import { rpc, signer } from "../rpc";
import { Args } from "@oclif/core";

export default class InitializeConfig extends BaseCommand {
  static override args = {
    defaultAuthority: addressArg({
      description: "Authority who can collect fees",
      required: true,
    }),
    defaultProtocolFeeRate: Args.integer({
      description: "Portion of fee rate taken stored as basis points. The maximum value equals to 25%",
      required: true,
      min: 0,
      max: 2500,
    }),
    defaultOrderProtocolFeeRate: Args.integer({
      description:
        "Limit order fee rate stored as hundredths of a basis point. The maximum value approximately equals to 6.55%",
      required: true,
      min: 0,
      max: 60000,
    }),
    defaultClpToOlpRewardRatio: Args.integer({
      description:
        "Reward ratio of concentrated liquidity providers to limit orders' liquidity providers stored as basis points",
      required: true,
      min: 0,
      max: 10000,
    }),
  };

  static override flags = {
    feeAuthority: addressFlag({
      description: "Authority who can change the fee rate",
    }),
    tokenBadgeAuthority: addressFlag({
      description: "Token badge authority",
    }),
  };

  static override description = "Create a fusion amm config";
  static override examples = ["<%= config.bin %> <%= command.id %> address 1000 500 0"];

  public async run() {
    const { args, flags } = await this.parse(InitializeConfig);

    const defaultAuthority = args.defaultAuthority;

    const ix = getInitializeConfigInstruction({
      fusionPoolsConfig: (await getFusionPoolsConfigAddress())[0],
      funder: signer,
      collectProtocolFeesAuthority: defaultAuthority,
      feeAuthority: flags.feeAuthority ?? defaultAuthority,
      tokenBadgeAuthority: flags.tokenBadgeAuthority ?? defaultAuthority,
      defaultProtocolFeeRate: args.defaultProtocolFeeRate,
      defaultOrderProtocolFeeRate: args.defaultOrderProtocolFeeRate,
      defaultClpToOlpRewardRatio: args.defaultClpToOlpRewardRatio,
    });

    console.log("");
    console.log("Sending a transaction...");
    const signature = await sendTransaction(rpc, [ix], signer);
    console.log("Transaction landed:", signature);
  }
}
