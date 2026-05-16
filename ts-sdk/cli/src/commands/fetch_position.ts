import { fetchAllPositionWithFilter, fetchMaybePosition } from "@crypticdot/fusionamm-client";
import { fetchPositionsForOwner, fetchPositionsInFusionPool } from "@crypticdot/fusionamm-sdk";

import BaseCommand, { addressArg, addressFlag } from "../base";
import { rpc } from "../rpc";

export default class FetchPosition extends BaseCommand {
  static override args = {
    position: addressArg({
      description: "Position address",
    }),
  };
  static override flags = {
    pool: addressFlag({
      description: "Fusion pool address",
    }),
    owner: addressFlag({
      description: "Position owner address",
    }),
  };
  static override description = "Fetch a fusion position or the list of all positions";
  static override examples = ["<%= config.bin %> <%= command.id %> 3qx1xPHwQopPXQPPjZDNZ4PnKpQvYeC3s8tPHcC5Ux1V"];

  public async run() {
    const { args, flags } = await this.parse(FetchPosition);

    const positionAddress = args.position;

    if (positionAddress) {
      console.log(`Fetching position at address ${positionAddress}...`);
      const position = await fetchMaybePosition(rpc, positionAddress);
      if (position.exists) {
        console.log("Position:", position);
      } else {
        throw new Error(`Position is not found at address ${positionAddress}`);
      }
    } else {
      console.log("Fetching positions...");
      if (flags.pool && flags.owner) {
        const positions = await fetchPositionsForOwner(rpc, flags.owner);
        for (const position of positions) {
          if (!position.isPositionBundle) {
            if (position.data.fusionPool == flags.pool) console.log(position.address);
          }
        }
      } else if (flags.pool) {
        const positions = await fetchPositionsInFusionPool(rpc, flags.pool);
        for (const position of positions) {
          if (!position.isPositionBundle) {
            if (position.data.fusionPool == flags.pool) console.log(position.address);
          }
        }
      } else if (flags.owner) {
        const positions = await fetchPositionsForOwner(rpc, flags.owner);
        for (const position of positions) console.log(position.address);
      } else {
        const positions = await fetchAllPositionWithFilter(rpc);
        for (const position of positions) console.log(position.address);
      }
    }
  }
}
