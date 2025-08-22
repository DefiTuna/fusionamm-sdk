import {
  fetchMaybeFusionPoolsConfig,
  getFusionPoolsConfigAddress,
  getSetCollectProtocolFeesAuthorityInstruction,
} from "@crypticdot/fusionamm-client";
import { sendTransaction } from "@crypticdot/fusionamm-tx-sender";
import BaseCommand, { addressArg } from "../base";
import { rpc, signer } from "../rpc";

export default class SetCollectProtocolFeesAuthority extends BaseCommand {
  static override args = {
    collectProtocolFeesAuthority: addressArg({
      description: "New collect protocol fees authority",
      required: true,
    }),
  };
  static override description = "Sets a new collect protocol fees authority";
  static override examples = ["<%= config.bin %> <%= command.id %> CHfRSfveGjWoq69g9LqYNPy4ZTESe5tZYLxhEs6koAxK"];

  public async run() {
    const { args } = await this.parse(SetCollectProtocolFeesAuthority);

    const fusionPoolsConfig = (await getFusionPoolsConfigAddress())[0];

    const config = await fetchMaybeFusionPoolsConfig(rpc, fusionPoolsConfig);
    if (config.exists) {
      console.log("Config:", config);
    } else {
      throw new Error("FusionAMM config doesn't exists at address " + fusionPoolsConfig);
    }

    const ix = getSetCollectProtocolFeesAuthorityInstruction({
      fusionPoolsConfig: fusionPoolsConfig,
      collectProtocolFeesAuthority: signer,
      newCollectProtocolFeesAuthority: args.collectProtocolFeesAuthority,
    });

    console.log("");
    if (config.data.collectProtocolFeesAuthority != args.collectProtocolFeesAuthority) {
      console.log("Sending a transaction...");
      const signature = await sendTransaction(rpc, [ix], signer);
      console.log("Transaction landed:", signature);
    } else {
      console.log("Nothing to update!");
    }
  }
}
