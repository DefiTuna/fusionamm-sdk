import {
  fetchMaybeFusionPool,
  getFusionPoolsConfigAddress,
  getSetProtocolFeeRateInstruction,
} from "@crypticdot/fusionamm-client";
import { sendTransaction } from "@crypticdot/fusionamm-tx-sender";
import { Args } from "@oclif/core";

import BaseCommand, { addressArg } from "../base";
import { rpc, signer } from "../rpc";

export default class SetProtocolFeeRate extends BaseCommand {
  static override args = {
    pool: addressArg({
      description: "Fusion pool address",
      required: true,
    }),
    protocolFeeRate: Args.integer({
      description: "Protocol fee rate stored as basis points. The maximum value 2500 equals to 25%",
      required: true,
      min: 0,
      max: 60_000,
    }),
  };
  static override description = "Set the protocol fee rate of a pool";
  static override examples = ["<%= config.bin %> <%= command.id %> address 100"];

  public async run() {
    const { args } = await this.parse(SetProtocolFeeRate);

    const fusionPoolsConfig = (await getFusionPoolsConfigAddress())[0];

    console.log(`Fetching fusion pool at address ${args.pool}...`);
    const fusionPool = await fetchMaybeFusionPool(rpc, args.pool);
    if (fusionPool.exists) {
      console.log("Fusion pool:", fusionPool);
    } else {
      throw new Error(`Fusion pool is not found at address ${args.pool}`);
    }

    const ix = getSetProtocolFeeRateInstruction({
      fusionPool: args.pool,
      fusionPoolsConfig: fusionPoolsConfig,
      feeAuthority: signer,
      protocolFeeRate: args.protocolFeeRate,
    });

    console.log("");
    if (fusionPool.data.protocolFeeRate != args.protocolFeeRate) {
      console.log("Sending a transaction...");
      const signature = await sendTransaction(rpc, [ix], signer);
      console.log("Transaction landed:", signature);
    } else {
      console.log("Nothing to update!");
    }
  }
}
