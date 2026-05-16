use crate::FUSIONAMM_ID;
use solana_program::program_error::ProgramError;
use solana_program::pubkey::Pubkey;

pub fn get_position_lock_address(position_mint: &Pubkey) -> Result<(Pubkey, u8), ProgramError> {
    let seeds = &[b"position_lock", position_mint.as_ref()];
    Pubkey::try_find_program_address(seeds, &FUSIONAMM_ID).ok_or(ProgramError::InvalidSeeds)
}
