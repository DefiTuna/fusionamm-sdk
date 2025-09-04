import { Clock } from "solana-bankrun";
import { getTestContext } from "./mockRpc";

export async function moveTimeForward(interval: bigint) {
  const testContext = await getTestContext();
  const currentClock = await testContext.banksClient.getClock();
  testContext.setClock(
    new Clock(
      currentClock.slot,
      currentClock.epochStartTimestamp,
      currentClock.epoch,
      currentClock.leaderScheduleEpoch,
      currentClock.unixTimestamp + interval,
    ),
  );
}
