import { fetchMaybeFusionPool, fetchAllFusionPoolWithFilter } from "@crypticdot/fusionamm-client";
import BaseCommand, { addressArg } from "../base";
import { rpc } from "../rpc";
import { fetchAllMint } from "@solana-program/token-2022";
import { sqrtPriceToPrice } from "@crypticdot/fusionamm-core";

export default class FetchPool extends BaseCommand {
  static override args = {
    pool: addressArg({
      description: "Fusion pool address",
    }),
  };
  static override description = "Fetch a fusion pool or the list of pools";
  static override examples = ["<%= config.bin %> <%= command.id %> 3qx1xPHwQopPXQPPjZDNZ4PnKpQvYeC3s8tPHcC5Ux1V"];

  public async run() {
    const { args, flags } = await this.parse(FetchPool);

    const fusionPoolAddress = args.pool;

    if (fusionPoolAddress) {
      console.log(`Fetching fusion pool at address ${fusionPoolAddress}...`);
      const fusionPool = await fetchMaybeFusionPool(rpc, fusionPoolAddress);
      if (fusionPool.exists) {
        console.log("Fusion pool:", fusionPool);

        const [mintA, mintB] = await fetchAllMint(rpc, [fusionPool.data.tokenMintA, fusionPool.data.tokenMintB]);
        console.log(
          "Current pool price:",
          sqrtPriceToPrice(fusionPool.data.sqrtPrice, mintA.data.decimals, mintB.data.decimals),
        );
        console.log(
          "Current pool MA price:",
          sqrtPriceToPrice(fusionPool.data.maSqrtPrice, mintA.data.decimals, mintB.data.decimals),
        );
      } else {
        throw new Error(`Fusion pool is not found at address ${fusionPoolAddress}`);
      }
    } else {
      console.log("Fetching fusion pools...");
      const pools = await fetchAllFusionPoolWithFilter(rpc);
      for (let pool of pools) {
        console.log(pool.address);
      }
    }
  }
}
