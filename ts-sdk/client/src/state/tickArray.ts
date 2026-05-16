import { MaybeTick, TickArray } from "../generated";

export interface TickFacade {
  initialized: boolean;
  liquidityNet: bigint;
  liquidityGross: bigint;
  feeGrowthOutsideA: bigint;
  feeGrowthOutsideB: bigint;
  age: bigint;
  openOrdersInput: bigint;
  partFilledOrdersInput: bigint;
  partFilledOrdersRemainingInput: bigint;
  fulfilledAToBOrdersInput: bigint;
  fulfilledBToAOrdersInput: bigint;
}

export interface TickArrayFacade {
  startTickIndex: number;
  ticks: TickFacade[];
}

export function getTickArrayMinSize(): number {
  return 132; // 8+4+32+88
}

export function getTickArrayMaxSize(): number {
  return 9988; // 8+4+32+88*113
}

export function maybeTickToFacade(tick: MaybeTick): TickFacade {
  switch (tick.__kind) {
    case "Uninitialized":
      return {
        initialized: false,
        liquidityGross: 0n,
        liquidityNet: 0n,
        feeGrowthOutsideA: 0n,
        feeGrowthOutsideB: 0n,
        age: 0n,
        fulfilledAToBOrdersInput: 0n,
        fulfilledBToAOrdersInput: 0n,
        openOrdersInput: 0n,
        partFilledOrdersInput: 0n,
        partFilledOrdersRemainingInput: 0n,
      };
    case "Initialized":
      return {
        initialized: true,
        liquidityGross: tick.fields[0].liquidityGross,
        liquidityNet: tick.fields[0].liquidityNet,
        feeGrowthOutsideA: tick.fields[0].feeGrowthOutsideA,
        feeGrowthOutsideB: tick.fields[0].feeGrowthOutsideB,
        age: tick.fields[0].age,
        fulfilledAToBOrdersInput: tick.fields[0].fulfilledAToBOrdersInput,
        fulfilledBToAOrdersInput: tick.fields[0].fulfilledBToAOrdersInput,
        openOrdersInput: tick.fields[0].openOrdersInput,
        partFilledOrdersInput: tick.fields[0].partFilledOrdersInput,
        partFilledOrdersRemainingInput: tick.fields[0].partFilledOrdersRemainingInput,
      };
  }
}

export function tickArrayToFacade(tickArray: TickArray): TickArrayFacade {
  return {
    startTickIndex: tickArray.startTickIndex,
    ticks: tickArray.ticks.map(maybeTick => maybeTickToFacade(maybeTick)),
  };
}
