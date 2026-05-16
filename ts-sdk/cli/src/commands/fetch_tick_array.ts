import {
  fetchMaybeFusionPool,
  fetchMaybeTickArray,
  getTickArrayAddress,
  maybeTickToFacade,
} from "@crypticdot/fusionamm-client";
import { _TICK_ARRAY_SIZE, getTickArrayStartTickIndex, getTickIndexInArray } from "@crypticdot/fusionamm-core";
import { Flags } from "@oclif/core";

import BaseCommand, { addressArg, addressFlag } from "../base";
import { rpc } from "../rpc";

export default class FetchTickArray extends BaseCommand {
  static override args = {
    tickArray: addressArg({
      description: "Tick array address",
    }),
  };
  static override flags = {
    pool: addressFlag({
      description: "Fusion pool address",
    }),
    tickIndex: Flags.integer({
      description: "Tick index",
    }),
  };
  static override description = "Fetch a tick array by tick index";
  static override examples = ["<%= config.bin %> <%= command.id %> 3qx1xPHwQopPXQPPjZDNZ4PnKpQvYeC3s8tPHcC5Ux1V 23000"];

  public async run() {
    const { args, flags } = await this.parse(FetchTickArray);

    if (args.tickArray) {
      console.log(`Fetching TickArray at address ${args.tickArray}...`);
      const tickArray = await fetchMaybeTickArray(rpc, args.tickArray);
      if (tickArray.exists) {
        console.log(`Fetching fusion pool at address ${tickArray.data.fusionPool}...`);
        const fusionPool = await fetchMaybeFusionPool(rpc, tickArray.data.fusionPool);
        if (!fusionPool.exists) {
          throw new Error(`Fusion pool is not found at address ${tickArray.data.fusionPool}`);
        }

        console.log("TickArray", tickArray);
        for (let i = 0; i < _TICK_ARRAY_SIZE(); i++) {
          console.log(
            `Index=${i}, tickIndex=${tickArray.data.startTickIndex + i * fusionPool.data.tickSpacing}:`,
            tickArray.data.ticks[i],
          );
        }
      } else {
        console.log("TickArray doesn't exist");
      }
    } else {
      if (!flags.pool || !flags.tickIndex) {
        throw new Error("Pool address and tickIndex must be provided if the tick array address is not set");
      }

      console.log(`Fetching fusion pool at address ${flags.pool}...`);
      const fusionPool = await fetchMaybeFusionPool(rpc, flags.pool);
      if (!fusionPool.exists) {
        throw new Error(`Fusion pool is not found at address ${flags.pool}`);
      }
      console.log("Fusion pool:", fusionPool);

      if (flags.tickIndex % fusionPool.data.tickSpacing != 0) {
        throw new Error("The provided tickIndex must be initializable");
      }
      const startTickIndex = getTickArrayStartTickIndex(flags.tickIndex, fusionPool.data.tickSpacing);
      const tickArrayAddress = (await getTickArrayAddress(flags.pool, startTickIndex))[0];

      console.log(`Fetching TickArray at address ${tickArrayAddress}...`);
      const tickArray = await fetchMaybeTickArray(rpc, tickArrayAddress);
      if (tickArray.exists) {
        console.log("TickArray", tickArray);

        const i = getTickIndexInArray(flags.tickIndex, startTickIndex, fusionPool.data.tickSpacing);
        console.log(`Tick ${flags.tickIndex}, index in array ${i}:`);
        console.log(maybeTickToFacade(tickArray.data.ticks[i]));
      } else {
        console.log("TickArray doesn't exist");
      }
    }
  }
}
