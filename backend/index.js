const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const { Connection, PublicKey, Keypair, Transaction } = require('@solana/web3.js');
const { Token, TOKEN_PROGRAM_ID } = require('@solana/spl-token');

// Initialize express app
const app = express();
app.use(cors());
app.use(express.json());

// Create HTTP server
const server = http.createServer(app);

// Initialize Socket.IO
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Solana connection
const connection = new Connection(
  'https://radial-chaotic-pool.solana-mainnet.quiknode.pro/192e8e76f0a288f5a32ace0b676f7f34778f219f/',
  'confirmed'
);

// Token mint address
const TOKEN_MINT = new PublicKey('38KWMyCbPurCgqqwx5JG4EouREtjwcCaDqvL9KNGsvDf');

// Program ID (replace with your deployed program ID)
const PROGRAM_ID = new PublicKey('YOUR_DEPLOYED_PROGRAM_ID');

// Game state
const gameState = {
  currentRace: {
    players: [],
    state: 'waiting', // 'waiting', 'racing', 'completed'
    startTime: null,
    countdown: 30,
    winner: null,
  }
};

// Race management
function resetRace() {
  gameState.currentRace = {
    players: [],
    state: 'waiting',
    startTime: null,
    countdown: 30,
    winner: null,
  };
  io.emit('raceReset');
}

// Start a new countdown when first player joins
function startCountdown() {
  gameState.currentRace.startTime = Date.now();
  
  const countdownInterval = setInterval(() => {
    const elapsedSeconds = Math.floor((Date.now() - gameState.currentRace.startTime) / 1000);
    const remainingSeconds = gameState.currentRace.countdown - elapsedSeconds;
    
    if (remainingSeconds <= 0 || gameState.currentRace.players.length >= 8) {
      clearInterval(countdownInterval);
      if (gameState.currentRace.players.length >= 2) {
        startRace();
      } else {
        // Not enough players, reset the countdown
        resetRace();
      }
    } else {
      io.emit('countdown', { remainingSeconds });
    }
  }, 1000);
}

// Start the race
function startRace() {
  if (gameState.currentRace.players.length < 2) {
    return;
  }
  
  gameState.currentRace.state = 'racing';
  io.emit('raceStarted');
  
  // Simulate race (3 seconds)
  setTimeout(() => {
    // Determine winner (random)
    const winnerIndex = Math.floor(Math.random() * gameState.currentRace.players.length);
    gameState.currentRace.winner = gameState.currentRace.players[winnerIndex];
    gameState.currentRace.state = 'completed';
    
    io.emit('raceCompleted', { 
      winner: gameState.currentRace.winner 
    });
    
    // Start a new race after 10 seconds
    setTimeout(resetRace, 10000);
  }, 3000);
}

// Socket.IO connection
io.on('connection', (socket) => {
  console.log('New client connected');
  
  // Send current game state to new connections
  socket.emit('gameState', gameState);
  
  // Handle player joining race
  socket.on('joinRace', async (data) => {
    try {
      const { wallet, signature } = data;
      
      if (gameState.currentRace.state !== 'waiting') {
        socket.emit('error', { message: 'Race already in progress' });
        return;
      }
      
      if (gameState.currentRace.players.length >= 8) {
        socket.emit('error', { message: 'Race is full' });
        return;
      }
      
      // Check if player already joined
      if (gameState.currentRace.players.find(p => p.wallet === wallet)) {
        socket.emit('error', { message: 'Already joined this race' });
        return;
      }
      
      // Verify transaction on blockchain (simplified)
      // In production, you'd want to verify the transaction details more thoroughly
      const txInfo = await connection.getTransaction(signature);
      if (!txInfo) {
        socket.emit('error', { message: 'Invalid transaction' });
        return;
      }
      
      // Add player to race
      const player = { wallet, joinedAt: Date.now() };
      gameState.currentRace.players.push(player);
      
      // Broadcast updated game state
      io.emit('playerJoined', { player, gameState });
      
      // Start countdown if this is the first player
      if (gameState.currentRace.players.length === 1) {
        startCountdown();
      }
      
      // Auto-start race if 8 players joined
      if (gameState.currentRace.players.length === 8) {
        startRace();
      }
    } catch (error) {
      console.error('Error joining race:', error);
      socket.emit('error', { message: 'Failed to join race' });
    }
  });
  
  // Handle claim request
  socket.on('claimWinnings', async (data) => {
    try {
      const { wallet, signature } = data;
      
      if (gameState.currentRace.state !== 'completed') {
        socket.emit('error', { message: 'Race not completed' });
        return;
      }
      
      if (gameState.currentRace.winner.wallet !== wallet) {
        socket.emit('error', { message: 'Only the winner can claim' });
        return;
      }
      
      // Verify claim transaction (simplified)
      const txInfo = await connection.getTransaction(signature);
      if (!txInfo) {
        socket.emit('error', { message: 'Invalid transaction' });
        return;
      }
      
      // Emit success
      socket.emit('claimSuccess');
      
    } catch (error) {
      console.error('Error claiming winnings:', error);
      socket.emit('error', { message: 'Failed to claim winnings' });
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

// Start server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
