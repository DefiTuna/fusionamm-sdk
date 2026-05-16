import {
  getFusionPoolsConfigAddress,
  getInitializeTokenBadgeInstruction,
  getTokenBadgeAddress,
} from "@crypticdot/fusionamm-client";
import { sendTransaction } from "@crypticdot/fusionamm-tx-sender";

import BaseCommand, { addressArg } from "../base";
import { rpc, signer } from "../rpc";

export default class InitializeTokenBadge extends BaseCommand {
  static override args = {
    mint: addressArg({
      description: "Token mint address",
      required: true,
    }),
  };
  static override description = "Create a token badge";
  static override examples = ["<%= config.bin %> <%= command.id %> BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k"];

  public async run() {
    const { args } = await this.parse(InitializeTokenBadge);

    const fusionPoolsConfigAddress = (await getFusionPoolsConfigAddress())[0];
    const tokenBadgeAddress = (await getTokenBadgeAddress(args.mint))[0];

    const ix = getInitializeTokenBadgeInstruction({
      funder: signer,
      tokenBadgeAuthority: signer,
      fusionPoolsConfig: fusionPoolsConfigAddress,
      tokenBadge: tokenBadgeAddress,
      tokenMint: args.mint,
    });

    console.log("Sending a transaction...");
    const signature = await sendTransaction(rpc, [ix], signer);
    console.log("Transaction landed:", signature);
  }
}
