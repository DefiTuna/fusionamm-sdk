import {
  fetchMaybeFusionPool,
  getFusionPoolsConfigAddress,
  getSetFeeRateInstruction,
} from "@crypticdot/fusionamm-client";
import { sendTransaction } from "@crypticdot/fusionamm-tx-sender";
import { Args } from "@oclif/core";

import BaseCommand, { addressArg } from "../base";
import { rpc, signer } from "../rpc";

export default class SetFeeRate extends BaseCommand {
  static override args = {
    pool: addressArg({
      description: "Fusion pool address",
      required: true,
    }),
    feeRate: Args.integer({
      description: "Fee rate is represented as hundredths of a basis point. The maximum value 60000 equals to 6%",
      required: true,
      min: 0,
      max: 60_000,
    }),
  };
  static override description = "Set the fee rate of a pool";
  static override examples = ["<%= config.bin %> <%= command.id %> address 4000"];

  public async run() {
    const { args } = await this.parse(SetFeeRate);

    const fusionPoolsConfig = (await getFusionPoolsConfigAddress())[0];

    console.log(`Fetching fusion pool at address ${args.pool}...`);
    const fusionPool = await fetchMaybeFusionPool(rpc, args.pool);
    if (fusionPool.exists) {
      console.log("Fusion pool:", fusionPool);
    } else {
      throw new Error(`Fusion pool is not found at address ${args.pool}`);
    }

    const ix = getSetFeeRateInstruction({
      fusionPool: args.pool,
      fusionPoolsConfig: fusionPoolsConfig,
      feeAuthority: signer,
      feeRate: args.feeRate,
    });

    console.log("");
    if (fusionPool.data.feeRate != args.feeRate) {
      console.log("Sending a transaction...");
      const signature = await sendTransaction(rpc, [ix], signer);
      console.log("Transaction landed:", signature);
    } else {
      console.log("Nothing to update!");
    }
  }
}
