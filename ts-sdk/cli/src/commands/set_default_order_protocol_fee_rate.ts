import {
  fetchMaybeFusionPoolsConfig,
  getFusionPoolsConfigAddress,
  getSetDefaultOrderProtocolFeeRateInstruction,
} from "@crypticdot/fusionamm-client";
import { sendTransaction } from "@crypticdot/fusionamm-tx-sender";
import BaseCommand, { addressArg } from "../base";
import { rpc, signer } from "../rpc";
import { Args } from "@oclif/core";

export default class SetDefaultOrderProtocolFeeRate extends BaseCommand {
  static override args = {
    defaultOrderProtocolFeeRate: Args.integer({
      description: "Limit order fee rate stored as basis points. The maximum value of 10000 equals to 100%",
      required: true,
      min: 0,
      max: 10000,
    }),
  };
  static override description = "Set the default limit order protocol fee rate";
  static override examples = ["<%= config.bin %> <%= command.id %> address 5000"];

  public async run() {
    const { args } = await this.parse(SetDefaultOrderProtocolFeeRate);

    const fusionPoolsConfig = (await getFusionPoolsConfigAddress())[0];

    const config = await fetchMaybeFusionPoolsConfig(rpc, fusionPoolsConfig);
    if (config.exists) {
      console.log("Config:", config);
    } else {
      throw new Error("FusionAMM config doesn't exists at address " + fusionPoolsConfig);
    }

    const ix = getSetDefaultOrderProtocolFeeRateInstruction({
      fusionPoolsConfig,
      feeAuthority: signer,
      defaultOrderProtocolFeeRate: args.defaultOrderProtocolFeeRate,
    });

    console.log("");
    if (config.data.defaultOrderProtocolFeeRate != args.defaultOrderProtocolFeeRate) {
      console.log("Sending a transaction...");
      const signature = await sendTransaction(rpc, [ix], signer);
      console.log("Transaction landed:", signature);
    } else {
      console.log("Nothing to update!");
    }
  }
}
