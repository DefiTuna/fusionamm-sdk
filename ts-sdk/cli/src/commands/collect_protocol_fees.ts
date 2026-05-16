import { collectProtocolFeesInstructions } from "@crypticdot/fusionamm-sdk";
import { sendTransaction } from "@crypticdot/fusionamm-tx-sender";

import BaseCommand, { addressArg } from "../base";
import { rpc, signer } from "../rpc";

export default class CollectProtocolFees extends BaseCommand {
  static override args = {
    pool: addressArg({
      description: "Fusion pool address",
      required: true,
    }),
  };
  static override description = "Collects the protocol fees";
  static override examples = ["<%= config.bin %> <%= command.id %> CHfRSfveGjWoq69g9LqYNPy4ZTESe5tZYLxhEs6koAxK"];

  public async run() {
    const { args } = await this.parse(CollectProtocolFees);

    const instructions = await collectProtocolFeesInstructions(rpc, args.pool, signer);

    console.log("Sending a transaction...");
    const signature = await sendTransaction(rpc, instructions, signer);
    console.log("Transaction landed:", signature);
  }
}
