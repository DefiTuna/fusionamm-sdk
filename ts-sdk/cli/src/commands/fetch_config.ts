import { fetchMaybeFusionPoolsConfig, getFusionPoolsConfigAddress } from "@crypticdot/fusionamm-client";

import BaseCommand from "../base";
import { rpc } from "../rpc";

export default class FetchFusionPoolsConfig extends BaseCommand {
  static override description = "Fetch Fusion AMM config";
  static override examples = ["<%= config.bin %> <%= command.id %>"];

  public async run() {
    const fusionPoolsConfig = (await getFusionPoolsConfigAddress())[0];

    const config = await fetchMaybeFusionPoolsConfig(rpc, fusionPoolsConfig);
    if (config.exists) {
      console.log("Config:", config);
    } else {
      throw new Error("FusionAMM config doesn't exists at address " + fusionPoolsConfig);
    }
  }
}
