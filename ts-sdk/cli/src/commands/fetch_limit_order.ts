import {
  fetchAllLimitOrderWithFilter,
  fetchFusionPool,
  fetchMaybeLimitOrder,
  fetchTickArray,
  FusionPool,
  getTickArrayAddress,
  LimitOrder,
  maybeTickToFacade,
  TickArray,
} from "@crypticdot/fusionamm-client";
import {
  decreaseLimitOrderQuote,
  getTickArrayStartTickIndex,
  getTickIndexInArray,
  tickIndexToPrice,
} from "@crypticdot/fusionamm-core";
import { fetchLimitOrdersForOwner, fetchLimitOrdersInFusionPool } from "@crypticdot/fusionamm-sdk";
import { Account, Address } from "@solana/kit";
import { fetchMint, Mint } from "@solana-program/token-2022";

import BaseCommand, { addressArg, addressFlag } from "../base";
import { rpc } from "../rpc";

export default class FetchLimitOrder extends BaseCommand {
  static override args = {
    limitOrder: addressArg({
      description: "Limit order address",
    }),
  };
  static override flags = {
    pool: addressFlag({
      description: "Fusion pool address",
    }),
    owner: addressFlag({
      description: "Limit order owner address",
    }),
  };
  static override description = "Fetch a fusion limit order or the list of all limit orders";
  static override examples = ["<%= config.bin %> <%= command.id %> 3qx1xPHwQopPXQPPjZDNZ4PnKpQvYeC3s8tPHcC5Ux1V"];

  static mints = new Map<Address, Account<Mint>>();
  static pools = new Map<Address, Account<FusionPool>>();
  static tickArrays = new Map<Address, Account<TickArray>>();

  async logLimitOrder(limitOrder: Account<LimitOrder>) {
    if (!FetchLimitOrder.pools.has(limitOrder.data.fusionPool)) {
      const fusionPool = await fetchFusionPool(rpc, limitOrder.data.fusionPool);
      FetchLimitOrder.pools.set(limitOrder.data.fusionPool, fusionPool);
    }
    const fusionPool = FetchLimitOrder.pools.get(limitOrder.data.fusionPool)!;

    if (!FetchLimitOrder.mints.has(fusionPool.data.tokenMintA)) {
      const mint = await fetchMint(rpc, fusionPool.data.tokenMintA);
      FetchLimitOrder.mints.set(fusionPool.data.tokenMintA, mint);
    }
    const mintA = FetchLimitOrder.mints.get(fusionPool.data.tokenMintA)!;

    if (!FetchLimitOrder.mints.has(fusionPool.data.tokenMintB)) {
      const mint = await fetchMint(rpc, fusionPool.data.tokenMintB);
      FetchLimitOrder.mints.set(fusionPool.data.tokenMintB, mint);
    }
    const mintB = FetchLimitOrder.mints.get(fusionPool.data.tokenMintB)!;

    const price = tickIndexToPrice(limitOrder.data.tickIndex, mintA.data.decimals, mintB.data.decimals);

    const tickArrayStartIndex = getTickArrayStartTickIndex(limitOrder.data.tickIndex, fusionPool.data.tickSpacing);
    const tickArrayAddress = (await getTickArrayAddress(fusionPool.address, tickArrayStartIndex))[0];
    if (!FetchLimitOrder.tickArrays.has(tickArrayAddress)) {
      const tickArray = await fetchTickArray(rpc, tickArrayAddress);
      FetchLimitOrder.tickArrays.set(tickArrayAddress, tickArray);
    }
    const tickArray = FetchLimitOrder.tickArrays.get(tickArrayAddress)!;
    const tickIndexInArray = getTickIndexInArray(
      limitOrder.data.tickIndex,
      tickArrayStartIndex,
      fusionPool.data.tickSpacing,
    );
    const tick = tickArray.data.ticks[tickIndexInArray];

    const quote = decreaseLimitOrderQuote(
      fusionPool.data,
      limitOrder.data,
      maybeTickToFacade(tick),
      limitOrder.data.amount,
    );
    const fill =
      (limitOrder.data.aToB
        ? Number(limitOrder.data.amount - quote.amountOutA)
        : Number(limitOrder.data.amount - quote.amountOutB)) / Number(limitOrder.data.amount);

    console.log(
      `address: ${limitOrder.address}; orderMint: ${limitOrder.data.limitOrderMint}; price: ${price}; tickIndex: ${limitOrder.data.tickIndex}; ` +
        `size: ${limitOrder.data.amount}; aToB: ${limitOrder.data.aToB}; ` +
        `fill: ${Math.round(fill * 100)}%; out: [${quote.amountOutA}; ${quote.amountOutB}]`,
    );
  }

  public async run() {
    const { args, flags } = await this.parse(FetchLimitOrder);

    const limitOrderAddress = args.limitOrder;

    if (limitOrderAddress) {
      console.log(`Fetching limit order at address ${limitOrderAddress}...`);
      const limitOrder = await fetchMaybeLimitOrder(rpc, limitOrderAddress);
      if (limitOrder.exists) {
        await this.logLimitOrder(limitOrder);
      } else {
        throw new Error(`Limit order is not found at address ${limitOrderAddress}`);
      }
    } else {
      console.log("Fetching limit orders...");
      if (flags.owner) {
        const limitOrders = await fetchLimitOrdersForOwner(rpc, flags.owner);
        for (const limitOrder of limitOrders) {
          if (!flags.pool || (flags.pool && limitOrder.data.fusionPool == flags.pool)) {
            await this.logLimitOrder(limitOrder);
          }
        }
      } else if (flags.pool) {
        const limitOrders = await fetchLimitOrdersInFusionPool(rpc, flags.pool);
        for (const limitOrder of limitOrders) await this.logLimitOrder(limitOrder);
      } else {
        const limitOrders = await fetchAllLimitOrderWithFilter(rpc);
        for (const limitOrder of limitOrders) await this.logLimitOrder(limitOrder);
      }
    }
  }
}
