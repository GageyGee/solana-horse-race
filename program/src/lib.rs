use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint,
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvar::{clock::Clock, Sysvar},
    program::{invoke, invoke_signed},
    system_instruction,
};
use spl_token::{
    instruction as token_instruction,
    state::{Account as TokenAccount, Mint},
};

// Define program ID (this will be generated when you deploy)
solana_program::declare_id!("YOUR_PROGRAM_ID_HERE");

// Required token amount to join race
const REQUIRED_TOKEN_AMOUNT: u64 = 10_000;

// Game states
#[derive(BorshSerialize, BorshDeserialize, PartialEq, Debug, Clone)]
pub enum GameState {
    WaitingForPlayers,
    RaceInProgress,
    RaceCompleted,
}

// Player data
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct Player {
    pub wallet: Pubkey,
    pub joined_at: i64,
}

// Game data structure
#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct HorseRace {
    pub state: GameState,
    pub players: Vec<Player>,
    pub start_time: i64,
    pub winner_index: Option<usize>,
    pub token_mint: Pubkey,
}

// Instructions the program can handle
#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub enum HorseRaceInstruction {
    // Initialize a new race
    InitializeRace { token_mint: Pubkey },
    // Join the race by paying tokens
    JoinRace,
    // Start the race (triggered automatically by time or when 8 players join)
    StartRace,
    // Claim winnings (only winner can call this)
    ClaimWinnings,
}

// Program entrypoint
entrypoint!(process_instruction);

// Instruction processor
pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    let instruction = HorseRaceInstruction::try_from_slice(instruction_data)?;

    match instruction {
        HorseRaceInstruction::InitializeRace { token_mint } => {
            process_initialize_race(program_id, accounts, token_mint)
        }
        HorseRaceInstruction::JoinRace => process_join_race(program_id, accounts),
        HorseRaceInstruction::StartRace => process_start_race(program_id, accounts),
        HorseRaceInstruction::ClaimWinnings => process_claim_winnings(program_id, accounts),
    }
}

// Initialize a new race
fn process_initialize_race(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    token_mint: Pubkey,
) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();
    
    // Get accounts
    let initializer = next_account_info(accounts_iter)?;
    let game_account = next_account_info(accounts_iter)?;
    
    // Ensure the initializer is the signer
    if !initializer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    // Create new race data
    let horse_race = HorseRace {
        state: GameState::WaitingForPlayers,
        players: Vec::new(),
        start_time: 0,
        winner_index: None,
        token_mint,
    };
    
    // Serialize and save to the game account
    horse_race.serialize(&mut *game_account.data.borrow_mut())?;
    
    msg!("Race initialized with token mint: {}", token_mint);
    Ok(())
}

// Join the race
fn process_join_race(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();
    
    // Get accounts
    let player = next_account_info(accounts_iter)?;
    let player_token_account = next_account_info(accounts_iter)?;
    let game_account = next_account_info(accounts_iter)?;
    let game_token_account = next_account_info(accounts_iter)?;
    let token_program = next_account_info(accounts_iter)?;
    let clock_sysvar = next_account_info(accounts_iter)?;
    let clock = Clock::from_account_info(clock_sysvar)?;
    
    // Ensure the player is the signer
    if !player.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    // Load game data
    let mut horse_race = HorseRace::try_from_slice(&game_account.data.borrow())?;
    
    // Check if game is in waiting state
    if horse_race.state != GameState::WaitingForPlayers {
        return Err(ProgramError::InvalidAccountData);
    }
    
    // Check if player already joined
    if horse_race.players.iter().any(|p| p.wallet == *player.key) {
        return Err(ProgramError::InvalidAccountData);
    }
    
    // Check if race is full
    if horse_race.players.len() >= 8 {
        return Err(ProgramError::InvalidAccountData);
    }
    
    // Transfer tokens from player to game account
    let transfer_instruction = token_instruction::transfer(
        token_program.key,
        player_token_account.key,
        game_token_account.key,
        player.key,
        &[],
        REQUIRED_TOKEN_AMOUNT,
    )?;
    
    invoke(
        &transfer_instruction,
        &[
            player_token_account.clone(),
            game_token_account.clone(),
            player.clone(),
            token_program.clone(),
        ],
    )?;
    
    // Add player to the race
    horse_race.players.push(Player {
        wallet: *player.key,
        joined_at: clock.unix_timestamp,
    });
    
    // Check if race should start (8 players or first player joined more than 30 seconds ago)
    if horse_race.players.len() == 8 || 
        (horse_race.players.len() >= 2 && 
         clock.unix_timestamp - horse_race.players[0].joined_at >= 30) {
        horse_race.state = GameState::RaceInProgress;
        horse_race.start_time = clock.unix_timestamp;
    }
    
    // Save updated game data
    horse_race.serialize(&mut *game_account.data.borrow_mut())?;
    
    msg!("Player joined the race: {}", player.key);
    Ok(())
}

// Start the race
fn process_start_race(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();
    
    // Get accounts
    let caller = next_account_info(accounts_iter)?;
    let game_account = next_account_info(accounts_iter)?;
    let clock_sysvar = next_account_info(accounts_iter)?;
    let clock = Clock::from_account_info(clock_sysvar)?;
    
    // Ensure the caller is the signer
    if !caller.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    // Load game data
    let mut horse_race = HorseRace::try_from_slice(&game_account.data.borrow())?;
    
    // Check game state
    if horse_race.state != GameState::WaitingForPlayers {
        return Err(ProgramError::InvalidAccountData);
    }
    
    // Check if we have minimum 2 players
    if horse_race.players.len() < 2 {
        return Err(ProgramError::InvalidAccountData);
    }
    
    // Set race in progress
    horse_race.state = GameState::RaceInProgress;
    horse_race.start_time = clock.unix_timestamp;
    
    // Generate winner (using timestamp as a random seed)
    let random_seed = clock.unix_timestamp as u64;
    let winner_index = random_seed % horse_race.players.len() as u64;
    horse_race.winner_index = Some(winner_index as usize);
    
    // Update race state to completed
    horse_race.state = GameState::RaceCompleted;
    
    // Save updated game data
    horse_race.serialize(&mut *game_account.data.borrow_mut())?;
    
    msg!("Race completed! Winner: {}", horse_race.players[winner_index as usize].wallet);
    Ok(())
}

// Claim winnings
fn process_claim_winnings(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();
    
    // Get accounts
    let winner = next_account_info(accounts_iter)?;
    let winner_token_account = next_account_info(accounts_iter)?;
    let game_account = next_account_info(accounts_iter)?;
    let game_token_account = next_account_info(accounts_iter)?;
    let token_program = next_account_info(accounts_iter)?;
    
    // Ensure winner is the signer
    if !winner.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    // Load game data
    let horse_race = HorseRace::try_from_slice(&game_account.data.borrow())?;
    
    // Check game state
    if horse_race.state != GameState::RaceCompleted {
        return Err(ProgramError::InvalidAccountData);
    }
    
    // Check if there is a winner
    if horse_race.winner_index.is_none() {
        return Err(ProgramError::InvalidAccountData);
    }
    
    // Check if caller is the winner
    let winner_index = horse_race.winner_index.unwrap();
    if horse_race.players[winner_index].wallet != *winner.key {
        return Err(ProgramError::InvalidAccountData);
    }
    
    // Get token balance
    let token_account_data = TokenAccount::unpack(&game_token_account.data.borrow())?;
    let winning_amount = token_account_data.amount;
    
    // Transfer all tokens to winner
    let transfer_instruction = token_instruction::transfer(
        token_program.key,
        game_token_account.key,
        winner_token_account.key,
        &game_account.key,
        &[],
        winning_amount,
    )?;
    
    // Find PDA for game account to sign
    let (pda, bump_seed) = Pubkey::find_program_address(&[b"horse_race"], program_id);
    let seeds = &[b"horse_race", &[bump_seed]];
    
    invoke_signed(
        &transfer_instruction,
        &[
            game_token_account.clone(),
            winner_token_account.clone(),
            game_account.clone(),
            token_program.clone(),
        ],
        &[&seeds],
    )?;
    
    msg!("Winnings claimed by: {}", winner.key);
    
    // Initialize a new race (reset)
    let mut new_race = horse_race.clone();
    new_race.state = GameState::WaitingForPlayers;
    new_race.players = Vec::new();
    new_race.start_time = 0;
    new_race.winner_index = None;
    
    // Save new race data
    new_race.serialize(&mut *game_account.data.borrow_mut())?;
    
    msg!("New race initialized");
    Ok(())
}
