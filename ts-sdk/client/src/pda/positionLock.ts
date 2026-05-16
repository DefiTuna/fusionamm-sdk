import type { Address, ProgramDerivedAddress } from "@solana/kit";
import { getAddressEncoder, getProgramDerivedAddress } from "@solana/kit";

import { FUSIONAMM_PROGRAM_ADDRESS } from "../generated";

export async function getPositionLockAddress(positionMint: Address): Promise<ProgramDerivedAddress> {
  return await getProgramDerivedAddress({
    programAddress: FUSIONAMM_PROGRAM_ADDRESS,
    seeds: ["position_lock", getAddressEncoder().encode(positionMint)],
  });
}
