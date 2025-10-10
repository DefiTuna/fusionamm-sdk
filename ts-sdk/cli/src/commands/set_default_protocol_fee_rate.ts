import {
  fetchMaybeFusionPoolsConfig,
  getFusionPoolsConfigAddress,
  getSetDefaultProtocolFeeRateInstruction,
} from "@crypticdot/fusionamm-client";
import { sendTransaction } from "@crypticdot/fusionamm-tx-sender";
import BaseCommand, { addressArg } from "../base";
import { rpc, signer } from "../rpc";
import { Args } from "@oclif/core";

export default class SetDefaultProtocolFeeRate extends BaseCommand {
  static override args = {
    defaultProtocolFeeRate: Args.integer({
      description: "Protocol fee rate taken stored as basis points. The maximum value 2500 equals to 25%",
      required: true,
      min: 0,
      max: 2500,
    }),
  };
  static override description = "Set the default protocol fee rate";
  static override examples = ["<%= config.bin %> <%= command.id %> 100"];

  public async run() {
    const { args } = await this.parse(SetDefaultProtocolFeeRate);

    const fusionPoolsConfig = (await getFusionPoolsConfigAddress())[0];

    const config = await fetchMaybeFusionPoolsConfig(rpc, fusionPoolsConfig);
    if (config.exists) {
      console.log("Config:", config);
    } else {
      throw new Error("FusionAMM config doesn't exists at address " + fusionPoolsConfig);
    }

    const ix = getSetDefaultProtocolFeeRateInstruction({
      fusionPoolsConfig: fusionPoolsConfig,
      feeAuthority: signer,
      defaultProtocolFeeRate: args.defaultProtocolFeeRate,
    });

    console.log("");
    if (config.data.defaultProtocolFeeRate != args.defaultProtocolFeeRate) {
      console.log("Sending a transaction...");
      const signature = await sendTransaction(rpc, [ix], signer);
      console.log("Transaction landed:", signature);
    } else {
      console.log("Nothing to update!");
    }
  }
}
