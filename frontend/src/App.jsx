import React, { useState, useEffect } from 'react';
import { Connection, PublicKey, Transaction, SystemProgram } from '@solana/web3.js';
import { Token, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { io } from 'socket.io-client';

// Initialize connection to backend server
const socket = io('http://localhost:3001');

function App() {
  const [connected, setConnected] = useState(false);
  const [wallet, setWallet] = useState(null);
  const [gameState, setGameState] = useState({
    currentRace: {
      players: [],
      state: 'waiting',
      countdown: 30,
      winner: null,
    }
  });
  const [remainingSeconds, setRemainingSeconds] = useState(30);
  const [message, setMessage] = useState('');
  const [showClaim, setShowClaim] = useState(false);

  // Connect to Phantom wallet
  const connectWallet = async () => {
    try {
      if (!window.solana || !window.solana.isPhantom) {
        setMessage('Phantom wallet not installed. Please install it from https://phantom.app/');
        return;
      }

      const response = await window.solana.connect();
      const publicKey = response.publicKey.toString();
      
      setWallet({
        publicKey,
        adapter: window.solana,
      });
      
      setConnected(true);
      setMessage(`Connected: ${publicKey.slice(0, 4)}...${publicKey.slice(-4)}`);
    } catch (error) {
      console.error('Error connecting wallet:', error);
      setMessage('Failed to connect wallet');
    }
  };

  // Join the race
  const joinRace = async () => {
    try {
      if (!connected || !wallet) {
        setMessage('Please connect your wallet first');
        return;
      }

      if (gameState.currentRace.state !== 'waiting') {
        setMessage('Race already in progress');
        return;
      }

      if (gameState.currentRace.players.length >= 8) {
        setMessage('Race is full');
        return;
      }

      // Check if already joined
      if (gameState.currentRace.players.find(p => p.wallet === wallet.publicKey)) {
        setMessage('You have already joined this race');
        return;
      }

      setMessage('Joining race...');

      // Create a connection to the Solana cluster
      const connection = new Connection(
        'https://radial-chaotic-pool.solana-mainnet.quiknode.pro/192e8e76f0a288f5a32ace0b676f7f34778f219f/',
        'confirmed'
      );

      // Program ID (replace with your deployed program ID)
      const programId = new PublicKey('YOUR_DEPLOYED_PROGRAM_ID');
      
      // Token mint address
      const tokenMint = new PublicKey('38KWMyCbPurCgqqwx5JG4EouREtjwcCaDqvL9KNGsvDf');

      // Find PDA for the game account
      const [gameAccount] = await PublicKey.findProgramAddress(
        [Buffer.from('horse_race')],
        programId
      );

      // Get token account for the player
      const playerTokenAccount = await Token.getAssociatedTokenAddress(
        TOKEN_PROGRAM_ID,
        tokenMint,
        new PublicKey(wallet.publicKey),
        false
      );

      // Get token account for the game
      const gameTokenAccount = await Token.getAssociatedTokenAddress(
        TOKEN_PROGRAM_ID,
        tokenMint,
        gameAccount,
        true
      );

      // Create transaction
      const transaction = new Transaction().add(
        // Join race instruction (specific to your program)
        // This is a simplified version - you'll need to adjust based on your actual program
        SystemProgram.transfer({
          fromPubkey: new PublicKey(wallet.publicKey),
          toPubkey: gameAccount,
          lamports: 10000, // This is just a placeholder
        })
      );

      // Sign and send transaction
      transaction.feePayer = new PublicKey(wallet.publicKey);
      transaction.recentBlockhash = (await connection.getRecentBlockhash()).blockhash;
      
      const signedTransaction = await wallet.adapter.signTransaction(transaction);
      const signature = await connection.sendRawTransaction(signedTransaction.serialize());
      
      await connection.confirmTransaction(signature);

      // Notify the server
      socket.emit('joinRace', {
        wallet: wallet.publicKey,
        signature,
      });

      setMessage('Successfully joined the race!');
    } catch (error) {
      console.error('Error joining race:', error);
      setMessage(`Failed to join race: ${error.message}`);
    }
  };

  // Claim winnings
  const claimWinnings = async () => {
    try {
      if (!connected || !wallet) {
        setMessage('Please connect your wallet first');
        return;
      }

      if (gameState.currentRace.state !== 'completed') {
        setMessage('Race not completed yet');
        return;
      }

      if (gameState.currentRace.winner.wallet !== wallet.publicKey) {
        setMessage('Only the winner can claim');
        return;
      }

      setMessage('Claiming winnings...');

      // Create a connection to the Solana cluster
      const connection = new Connection(
        'https://radial-chaotic-pool.solana-mainnet.quiknode.pro/192e8e76f0a288f5a32ace0b676f7f34778f219f/',
        'confirmed'
      );

      // Program ID (replace with your deployed program ID)
      const programId = new PublicKey('YOUR_DEPLOYED_PROGRAM_ID');
      
      // Create transaction for claiming (simplified)
      const transaction = new Transaction().add(
        // Claim winnings instruction (specific to your program)
        // This is a simplified version - you'll need to adjust based on your actual program
        SystemProgram.transfer({
          fromPubkey: new PublicKey(wallet.publicKey),
          toPubkey: new PublicKey(wallet.publicKey),
          lamports: 0, // Just a placeholder
        })
      );

      // Sign and send transaction
      transaction.feePayer = new PublicKey(wallet.publicKey);
      transaction.recentBlockhash = (await connection.getRecentBlockhash()).blockhash;
      
      const signedTransaction = await wallet.adapter.signTransaction(transaction);
      const signature = await connection.sendRawTransaction(signedTransaction.serialize());
      
      await connection.confirmTransaction(signature);

      // Notify the server
      socket.emit('claimWinnings', {
        wallet: wallet.publicKey,
        signature,
      });

      setShowClaim(false);
      setMessage('Successfully claimed winnings!');
    } catch (error) {
      console.error('Error claiming winnings:', error);
      setMessage(`Failed to claim winnings: ${error.message}`);
    }
  };

  // Socket.io event handlers
  useEffect(() => {
    socket.on('gameState', (state) => {
      setGameState(state);
    });

    socket.on('playerJoined', ({ player, gameState: newGameState }) => {
      setGameState(newGameState);
    });

    socket.on('countdown', ({ remainingSeconds: seconds }) => {
      setRemainingSeconds(seconds);
    });

    socket.on('raceStarted', () => {
      setMessage('Race has started!');
    });

    socket.on('raceCompleted', ({ winner }) => {
      setGameState(prev => ({
        ...prev,
        currentRace: {
          ...prev.currentRace,
          state: 'completed',
          winner,
        }
      }));

      if (wallet && winner.wallet === wallet.publicKey) {
        setMessage('You won! Claim your winnings!');
        setShowClaim(true);
      } else {
        setMessage(`Race completed! Winner: ${winner.wallet.slice(0, 4)}...${winner.wallet.slice(-4)}`);
      }
    });

    socket.on('raceReset', () => {
      setGameState(prev => ({
        ...prev,
        currentRace: {
          players: [],
          state: 'waiting',
          countdown: 30,
          winner: null,
        }
      }));
      setRemainingSeconds(30);
      setShowClaim(false);
      setMessage('New race starting! Join now!');
    });

    socket.on('error', ({ message }) => {
      setMessage(message);
    });

    socket.on('claimSuccess', () => {
      setMessage('Successfully claimed winnings!');
      setShowClaim(false);
    });

    return () => {
      socket.off('gameState');
      socket.off('playerJoined');
      socket.off('countdown');
      socket.off('raceStarted');
      socket.off('raceCompleted');
      socket.off('raceReset');
      socket.off('error');
      socket.off('claimSuccess');
    };
  }, [wallet]);

  // Render horse race animation
  const renderHorseRace = () => {
    if (gameState.currentRace.state === 'racing') {
      return (
        <div className="race-animation">
          {gameState.currentRace.players.map((player, index) => (
            <div key={index} className="horse" style={{ 
              animationDuration: `${2 + Math.random()}s`,
              top: `${50 + index * 50}px`
            }}>
              🐎 Player {player.wallet.slice(0, 4)}...{player.wallet.slice(-4)}
            </div>
          ))}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>Solana Horse Race</h1>
        
        {!connected ? (
          <button onClick={connectWallet} className="connect-button">
            Connect Phantom Wallet
          </button>
        ) : (
          <p className="wallet-info">
            Connected: {wallet.publicKey.slice(0, 4)}...{wallet.publicKey.slice(-4)}
          </p>
        )}
        
        <div className="race-info">
          <h2>Race Status: {gameState.currentRace.state}</h2>
          <p>Players: {gameState.currentRace.players.length}/8</p>
          
          {gameState.currentRace.state === 'waiting' && (
            <>
              <p>Countdown: {remainingSeconds}s</p>
              {connected && (
                <button onClick={joinRace} className="join-button">
                  Join Race (10,000 Tokens)
                </button>
              )}
            </>
          )}
          
          {gameState.currentRace.state === 'completed' && gameState.currentRace.winner && (
            <div className="winner-info">
              <h3>Winner: {gameState.currentRace.winner.wallet.slice(0, 4)}...{gameState.currentRace.winner.wallet.slice(-4)}</h3>
              {showClaim && (
                <button onClick={claimWinnings} className="claim-button">
                  Claim Winnings
                </button>
              )}
            </div>
          )}
        </div>
        
        {renderHorseRace()}
        
        <div className="players-list">
          <h3>Current Players:</h3>
          <ul>
            {gameState.currentRace.players.map((player, index) => (
              <li key={index}>
                {player.wallet.slice(0, 4)}...{player.wallet.slice(-4)}
              </li>
            ))}
          </ul>
        </div>
        
        <div className="message-box">
          {message}
        </div>
      </header>
      
      <style jsx>{`
        .App {
          text-align: center;
          background-color: #282c34;
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: flex-start;
          font-size: calc(10px + 1vmin);
          color: white;
          padding: 20px;
        }
        
        .App-header {
          width: 100%;
          max-width: 800px;
        }
        
        .connect-button, .join-button, .claim-button {
          background-color: #4CAF50;
          border: none;
          color: white;
          padding: 15px 32px;
          text-align: center;
          text-decoration: none;
          display: inline-block;
          font-size: 16px;
          margin: 10px 2px;
          cursor: pointer;
          border-radius: 4px;
        }
        
        .claim-button {
          background-color: #FFD700;
          color: black;
          font-weight: bold;
          animation: pulse 1.5s infinite;
        }
        
        .wallet-info {
          background-color: #333;
          padding: 10px;
          border-radius: 4px;
        }
        
        .race-info {
          background-color: #444;
          padding: 20px;
          border-radius: 8px;
          margin: 20px 0;
        }
        
        .players-list {
          background-color: #333;
          padding: 10px 20px;
          border-radius: 8px;
          margin: 20px 0;
          text-align: left;
        }
        
        .message-box {
          background-color: #555;
          padding: 15px;
          border-radius: 4px;
          margin-top: 20px;
        }
        
        .race-animation {
          position: relative;
          height: 400px;
          width: 100%;
          background-color: #2a5634;
          border-radius: 8px;
          margin: 20px 0;
          overflow: hidden;
        }
        
        .horse {
          position: absolute;
          left: 0;
          animation: race linear forwards;
        }
        
        @keyframes race {
          0% { left: 0; }
          100% { left: calc(100% - 150px); }
        }
        
        @keyframes pulse {
          0% { transform: scale(1); }
          50% { transform: scale(1.05); }
          100% { transform: scale(1); }
        }
      `}</style>
    </div>
  );
}

export default App;
