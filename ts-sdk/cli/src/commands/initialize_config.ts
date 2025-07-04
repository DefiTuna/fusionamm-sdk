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
      description: "Limit order fee rate stored as basis points. The maximum value of 10000 equals to 100%",
      required: true,
      min: 0,
      max: 10000,
    }),
    defaultClpRewardRate: Args.integer({
      description:
        "The reward rate for concentrated liquidity providers stored as basis points. The maximum value 10_000 equals to 100%",
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
      defaultClpRewardRate: args.defaultClpRewardRate,
    });

    console.log("");
    console.log("Sending a transaction...");
    const signature = await sendTransaction(rpc, [ix], signer);
    console.log("Transaction landed:", signature);
  }
}
