# Solana Horse Race dApp

A decentralized horse racing game on Solana where 2-8 players can compete for tokens. Players join by paying 10,000 tokens of a specific token, and the winner takes all.

## Project Structure

- `program/` - Solana smart contract (Rust)
- `backend/` - Node.js/Express server
- `frontend/` - React application

## Prerequisites

- [Rust](https://www.rust-lang.org/tools/install) and [Solana CLI](https://docs.solana.com/cli/install-solana-cli-tools) for program deployment
- [Node.js](https://nodejs.org/) (v16+) and npm for backend/frontend
- [Phantom Wallet](https://phantom.app/) browser extension

## Setup Instructions

### 1. Deploy the Solana Program

1. Navigate to the `program` directory
2. Build and deploy the program:

```bash
# Set up Solana CLI config for devnet/mainnet
solana config set --url https://radial-chaotic-pool.solana-mainnet.quiknode.pro/192e8e76f0a288f5a32ace0b676f7f34778f219f/

# Build the program
cargo build-bpf

# Deploy the program (this will output your program ID)
solana program deploy ./target/deploy/horse_race.so