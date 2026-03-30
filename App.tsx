import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage, Blob } from '@google/genai';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  FacebookAuthProvider, 
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from 'firebase/auth';
import { 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc 
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { Card, GameState, Player, Suit, SUITS, RANKS, RANK_VALUES, UserProfile, AppView, GameMode, Friend } from './types';
import CardComponent from './components/CardComponent';

const INITIAL_COINS = 500;
const STAKE_AMOUNT = 100;

const getLevelTitle = (level: number) => {
  if (level >= 100) return { title: 'LEGEND', color: 'text-yellow-400', bg: 'bg-yellow-400/10', border: 'border-yellow-400/30' };
  if (level >= 51) return { title: 'MASTER', color: 'text-red-500', bg: 'bg-red-500/10', border: 'border-red-500/30' };
  if (level >= 31) return { title: 'ELITE', color: 'text-indigo-400', bg: 'bg-indigo-400/10', border: 'border-indigo-400/30' };
  if (level >= 16) return { title: 'PRO', color: 'text-blue-400', bg: 'bg-blue-400/10', border: 'border-blue-400/30' };
  if (level >= 6) return { title: 'AMATEUR', color: 'text-emerald-400', bg: 'bg-emerald-400/10', border: 'border-emerald-400/30' };
  return { title: 'ROOKIE', color: 'text-slate-400', bg: 'bg-slate-400/10', border: 'border-slate-400/30' };
};

const createDeck = (): Card[] => {
  const deck: Card[] = [];
  SUITS.forEach(suit => {
    RANKS.forEach(rank => {
      deck.push({ suit, rank, value: RANK_VALUES[rank] });
    });
  });
  return deck.sort(() => Math.random() - 0.5);
};

const sortHand = (hand: Card[], trumpSuit: Suit | null): Card[] => {
  const baseSuits: Suit[] = ['spades', 'hearts', 'clubs', 'diamonds'];
  let sortedSuits = [...baseSuits];
  if (trumpSuit) {
    sortedSuits = baseSuits.filter(s => s !== trumpSuit);
    sortedSuits.push(trumpSuit);
  }
  return [...hand].sort((a, b) => {
    const aIdx = sortedSuits.indexOf(a.suit);
    const bIdx = sortedSuits.indexOf(b.suit);
    if (aIdx !== bIdx) return aIdx - bIdx;
    return b.value - a.value;
  });
};

// Audio helpers
function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

function createBlob(data: Float32Array): Blob {
  const l = data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    int16[i] = data[i] * 32768;
  }
  return {
    data: encode(new Uint8Array(int16.buffer)),
    mimeType: 'audio/pcm;rate=16000',
  };
}

const App: React.FC = () => {
  const [view, setView] = useState<AppView>('login');
  const [profile, setProfile] = useState<UserProfile>({ 
    turab_id: '',
    coins: INITIAL_COINS, wins: 0, losses: 0, gamesPlayed: 0, username: 'Elite Player',
    xp: 0, level: 1, scraps: 0, coupons: 0, skins: ['classic'], activeSkin: 'classic',
    frames: ['none'], activeFrame: 'none',
    friends: []
  });
  
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [trumpAlert, setTrumpAlert] = useState<{ suit: Suit; playerName: string } | null>(null);
  const [isThunderActive, setIsThunderActive] = useState(false);
  
  // Login State
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Mic state
  const [isMicActive, setIsMicActive] = useState(false);
  const isConnectingRef = useRef(false);
  const sessionRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextsRef = useRef<{ input: AudioContext; output: AudioContext } | null>(null);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const nextStartTimeRef = useRef(0);

  // Sync Firebase Profile
  const syncProfileToCloud = useCallback(async (newProfile: UserProfile) => {
    if (!newProfile.turab_id) return;
    try {
      const userRef = doc(db, 'users', newProfile.turab_id);
      await setDoc(userRef, newProfile, { merge: true });
    } catch (err) {
      console.error("Cloud Sync Failed:", err);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        const userRef = doc(db, 'users', user.uid);
        const userSnap = await getDoc(userRef);
        
        if (userSnap.exists()) {
          const cloudProfile = userSnap.data() as UserProfile;
          setProfile(cloudProfile);
        } else {
          setProfile(prev => {
            const newProfile: UserProfile = {
              ...prev,
              turab_id: user.uid,
              username: user.displayName || user.email?.split('@')[0] || 'Elite Player',
              friends: []
            };
            syncProfileToCloud(newProfile);
            return newProfile;
          });
        }
        setView('home');
      } else {
        setView('login');
      }
    });
    return () => unsubscribe();
  }, [syncProfileToCloud]);

  const handleLogin = async (method: 'google' | 'facebook' | 'email') => {
    setIsLoggingIn(true);
    try {
      if (method === 'google') {
        const provider = new GoogleAuthProvider();
        await signInWithPopup(auth, provider);
      } else if (method === 'facebook') {
        const provider = new FacebookAuthProvider();
        await signInWithPopup(auth, provider);
      } else if (method === 'email') {
        await signInWithEmailAndPassword(auth, loginEmail, loginPass);
      }
    } catch (err: any) {
      alert(err.message || "Authentication failed.");
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    setView('login');
    setProfile({ 
      turab_id: '',
      coins: INITIAL_COINS, wins: 0, losses: 0, gamesPlayed: 0, username: 'Elite Player',
      xp: 0, level: 1, scraps: 0, coupons: 0, skins: ['classic'], activeSkin: 'classic',
      frames: ['none'], activeFrame: 'none',
      friends: []
    });
  };

  const suitIcons: Record<Suit, string> = {
    hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠'
  };

  const teamAlphaScore = useMemo(() => {
    if (!gameState) return 0;
    return gameState.players[0].score + gameState.players[2].score;
  }, [gameState]);

  const playerHandSorted = useMemo(() => {
    if (!gameState) return [];
    return sortHand(gameState.players[0].hand, gameState.trumpSuit);
  }, [gameState]);

  const currentTrickWinnerId = useMemo(() => {
    if (!gameState || gameState.currentTrick.length === 0) return null;
    const trick = gameState.currentTrick;
    const lead = trick[0].card.suit;
    let winId = trick[0].playerId;
    let best = trick[0].card;

    trick.forEach(({ playerId, card }) => {
      if (gameState.trumpSuit && card.suit === gameState.trumpSuit) {
        if (best.suit !== gameState.trumpSuit || card.value > best.value) { winId = playerId; best = card; }
      } else if (card.suit === lead) {
        if (best.suit !== gameState.trumpSuit && card.value > best.value) { winId = playerId; best = card; }
      }
    });
    return winId;
  }, [gameState?.currentTrick, gameState?.trumpSuit]);

  const cleanupMic = useCallback(async () => {
    if (sessionRef.current) {
      try { sessionRef.current.close(); } catch (e) { console.debug('Session close error:', e); }
      sessionRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => {
        try { track.stop(); } catch (e) { console.debug('Track stop error:', e); }
      });
      streamRef.current = null;
    }
    if (audioContextsRef.current) {
      try {
        await audioContextsRef.current.input.close();
        await audioContextsRef.current.output.close();
      } catch (e) { console.debug('Context close error:', e); }
      audioContextsRef.current = null;
    }
    setIsMicActive(false);
  }, []);

  const toggleMic = async () => {
    if (isMicActive) {
      await cleanupMic();
      return;
    }

    if (isConnectingRef.current) return;
    isConnectingRef.current = true;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      
      if (inputCtx.state === 'suspended') await inputCtx.resume();
      if (outputCtx.state === 'suspended') await outputCtx.resume();
      
      audioContextsRef.current = { input: inputCtx, output: outputCtx };
      
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            const source = inputCtx.createMediaStreamSource(stream);
            const scriptProcessor = inputCtx.createScriptProcessor(4096, 1, 1);
            scriptProcessor.onaudioprocess = (e) => {
              if (sessionRef.current) {
                const inputData = e.inputBuffer.getChannelData(0);
                const pcmBlob = createBlob(inputData);
                sessionRef.current.sendRealtimeInput({ media: pcmBlob });
              }
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(inputCtx.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            const audioData = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (audioData && audioContextsRef.current) {
              const { output: ctx } = audioContextsRef.current;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              const buffer = await decodeAudioData(decode(audioData), ctx, 24000, 1);
              const source = ctx.createBufferSource();
              source.buffer = buffer;
              source.connect(ctx.destination);
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += buffer.duration;
              sourcesRef.current.add(source);
              source.onended = () => sourcesRef.current.delete(source);
            }
          },
          onclose: () => setIsMicActive(false),
          onerror: () => setIsMicActive(false),
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } },
          systemInstruction: 'You are an elite Turab card game host.'
        }
      });

      sessionRef.current = await sessionPromise;
      setIsMicActive(true);
    } catch (err: any) {
      alert('Microphone access failed.');
      await cleanupMic();
    } finally {
      isConnectingRef.current = false;
    }
  };

  const setupMatch = useCallback((code?: string) => {
    const deck = createDeck();
    const players: Player[] = [
      { id: 0, name: profile.username, hand: deck.slice(0, 13), score: 0, isAI: false, consecutiveWins: 0 },
      { id: 1, name: 'WEST_AI', hand: deck.slice(13, 26), score: 0, isAI: true, consecutiveWins: 0 },
      { id: 2, name: 'NORTH_AI', hand: deck.slice(26, 39), score: 0, isAI: true, consecutiveWins: 0 },
      { id: 3, name: 'EAST_AI', hand: deck.slice(39, 52), score: 0, isAI: true, consecutiveWins: 0 },
    ];
    setGameState({
      players, pile: [], wonPile: [], currentTrick: [],
      trumpSuit: null, currentTurn: 0, leadSuit: null, roundStatus: 'playing',
      history: ["Match initialized."],
      lastWinner: null, stake: STAKE_AMOUNT * 4,
      tableCode: code
    });
  }, [profile.username]);

  const startNewGame = useCallback((mode: GameMode, code?: string) => {
    if (profile.coins < STAKE_AMOUNT) return alert("Insufficient coins.");
    const updatedProfile = { ...profile, coins: profile.coins - STAKE_AMOUNT, gamesPlayed: profile.gamesPlayed + 1 };
    setProfile(updatedProfile);
    syncProfileToCloud(updatedProfile);
    
    if (mode === 'classic') {
      setView('searching');
      setTimeout(() => {
        setupMatch(code);
        setView('game');
      }, 1500);
    } else {
      setupMatch(code || 'LBY-' + Math.random().toString(36).substring(7).toUpperCase());
      setView('lobby');
    }
  }, [profile, setupMatch, syncProfileToCloud]);

  const playCard = useCallback(async (playerId: number, card: Card) => {
    if (!gameState || isProcessing || gameState.currentTrick.length >= 4 || gameState.currentTurn !== playerId) return;
    if (gameState.leadSuit && card.suit !== gameState.leadSuit && gameState.players[playerId].hand.some(c => c.suit === gameState.leadSuit)) return;

    setIsProcessing(true);
    setGameState(prev => {
      if (!prev) return null;
      let newTrump = prev.trumpSuit;
      let players = [...prev.players];
      
      if (prev.leadSuit && card.suit !== prev.leadSuit && !prev.trumpSuit) {
        newTrump = card.suit;
        setTrumpAlert({ suit: card.suit, playerName: prev.players[playerId].name });
        setIsThunderActive(true);
        setTimeout(() => {
          setIsThunderActive(false);
          setTrumpAlert(null);
        }, 1500);
        players = players.map(p => ({ ...p, consecutiveWins: p.id === playerId ? 1 : 0 }));
      }

      players = players.map(p => p.id === playerId ? { ...p, hand: p.hand.filter(c => c !== card) } : p);
      
      return { 
        ...prev, 
        players, 
        currentTrick: [...prev.currentTrick, { playerId, card }], 
        leadSuit: prev.leadSuit || card.suit, 
        trumpSuit: newTrump, 
        currentTurn: (prev.currentTurn + 1) % 4 
      };
    });
    setIsProcessing(false);
  }, [gameState, isProcessing]);

  useEffect(() => {
    if (gameState?.roundStatus === 'playing' && gameState.players[gameState.currentTurn].isAI && !isProcessing && gameState.currentTrick.length < 4) {
      const timer = setTimeout(() => {
        const p = gameState.players[gameState.currentTurn];
        const valid = gameState.leadSuit ? p.hand.filter(c => c.suit === gameState.leadSuit) : p.hand;
        const card = valid.length > 0 ? valid[Math.floor(Math.random() * valid.length)] : p.hand[0];
        if (card) playCard(p.id, card);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [gameState?.currentTurn, isProcessing, gameState?.roundStatus, gameState?.leadSuit, playCard]);

  useEffect(() => {
    if (gameState?.currentTrick.length === 4) {
      setIsProcessing(true);
      setTimeout(() => {
        setGameState(prev => {
          if (!prev) return null;
          const trick = prev.currentTrick;
          const lead = trick[0].card.suit;
          let winId = trick[0].playerId;
          let best = trick[0].card;

          trick.forEach(({ playerId, card }) => {
            if (prev.trumpSuit && card.suit === prev.trumpSuit) {
              if (best.suit !== prev.trumpSuit || card.value > best.value) { winId = playerId; best = card; }
            } else if (card.suit === lead) {
              if (best.suit !== prev.trumpSuit && card.value > best.value) { winId = playerId; best = card; }
            }
          });

          const winningTeamIndices = (winId === 0 || winId === 2) ? [0, 2] : [1, 3];
          let updatedPlayers = [...prev.players];
          const hasConsecutive = updatedPlayers[winId].consecutiveWins >= 1 || updatedPlayers[(winId + 2) % 4].consecutiveWins >= 1;
          
          let newPile = [...prev.pile, ...trick.map(t => t.card)];
          let newWonPile = [...prev.wonPile];
          
          if (hasConsecutive && prev.trumpSuit) {
            updatedPlayers = updatedPlayers.map(p => {
              if (winningTeamIndices.includes(p.id)) return { ...p, score: p.score + newPile.length, consecutiveWins: 0 };
              return { ...p, consecutiveWins: 0 };
            });
            newWonPile = [...newWonPile, ...newPile];
            newPile = [];
          } else {
            updatedPlayers = updatedPlayers.map(p => {
              if (p.id === winId) return { ...p, consecutiveWins: 1 };
              return { ...p, consecutiveWins: 0 };
            });
          }

          const ended = updatedPlayers.every(p => p.hand.length === 0);
          if (ended && winId === 0) {
            const xpGain = 150;
            const updatedProfile = { 
              ...profile, 
              xp: profile.xp + xpGain, 
              level: Math.floor((profile.xp + xpGain) / 1000) + 1,
              wins: profile.wins + 1 
            };
            setProfile(updatedProfile);
            syncProfileToCloud(updatedProfile);
          }

          return { ...prev, players: updatedPlayers, pile: newPile, wonPile: newWonPile, currentTrick: [], leadSuit: null, currentTurn: winId, roundStatus: ended ? 'ended' : 'playing' };
        });
        setIsProcessing(false);
      }, 1500);
    }
  }, [gameState?.currentTrick.length, profile, syncProfileToCloud]);

  if (view === 'login') {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center p-8 bg-[#02040a] relative overflow-hidden">
        <div className="w-full max-w-md z-10 space-y-12 text-center">
          <h1 className="text-6xl md:text-8xl turab-title font-black italic">TURAB'</h1>
          <div className="glass-panel p-10 rounded-[2.5rem] border-white/10 shadow-2xl">
            <h2 className="text-xl font-black uppercase tracking-widest mb-8 text-white/80">Authorize Access</h2>
            <div className="space-y-4">
              <input 
                type="email" 
                value={loginEmail}
                onChange={e => setLoginEmail(e.target.value)}
                placeholder="PLAYER EMAIL" 
                className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 text-sm font-black outline-none focus:border-indigo-500/50 focus:bg-white/10 transition-all uppercase placeholder:text-white/20" 
              />
              <input 
                type="password" 
                value={loginPass}
                onChange={e => setLoginPass(e.target.value)}
                placeholder="ACCESS KEY" 
                className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 text-sm font-black outline-none focus:border-indigo-500/50 focus:bg-white/10 transition-all uppercase placeholder:text-white/20" 
              />
              <button 
                onClick={() => handleLogin('email')}
                disabled={!loginEmail || !loginPass || isLoggingIn}
                className="gold-button w-full py-5 rounded-2xl text-lg mt-2 disabled:opacity-50"
              >
                {isLoggingIn ? 'SECURE HANDSHAKE...' : 'ENTER ARENA'}
              </button>
              <div className="grid grid-cols-2 gap-4 mt-4">
                <button onClick={() => handleLogin('google')} className="bg-white text-black rounded-2xl py-4 font-black text-[10px] uppercase">Google</button>
                <button onClick={() => handleLogin('facebook')} className="bg-[#1877F2] text-white rounded-2xl py-4 font-black text-[10px] uppercase">Facebook</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (view === 'home') {
    const userRank = getLevelTitle(profile.level);
    return (
      <div className="h-full w-full flex flex-col items-center justify-between p-8 bg-[#02040a] relative overflow-hidden">
        <div className="text-center mt-10">
          <h1 className="text-5xl md:text-7xl turab-title font-black italic">TURAB'</h1>
          <p className="text-indigo-400 font-black uppercase tracking-[0.4em] text-[10px] mt-2">Elite Card Series</p>
        </div>
        <div className="w-full max-w-sm space-y-4">
          <div className="glass-panel p-6 rounded-[2rem] flex items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-3xl shadow-lg">👤</div>
            <div className="flex-1">
              <div className={`text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded ${userRank.bg} ${userRank.color} border ${userRank.border} w-fit mb-1`}>{userRank.title}</div>
              <h2 className="text-xl font-black">{profile.username}</h2>
              <div className="text-lg font-black">{profile.coins} <span className="text-xs text-yellow-500">🪙</span></div>
            </div>
          </div>
          <button onClick={() => startNewGame('classic')} className="gold-button w-full py-6 rounded-3xl text-xl">Quick Start</button>
          <button onClick={handleLogout} className="w-full py-3 text-[8px] font-black uppercase text-white/20 hover:text-red-400">Sign Out</button>
        </div>
      </div>
    );
  }

  if (!gameState) return null;

  return (
    <div className="h-full w-full relative bg-[#01030a] flex flex-col items-center justify-center overflow-hidden">
      <div className="absolute top-0 left-0 p-4 md:p-6 z-[150]">
        <div className="flex gap-2">
          <button onClick={() => setView('home')} className="glass-panel w-10 h-10 rounded-full flex items-center justify-center">←</button>
          <div className="glass-panel p-2 px-5 rounded-xl border-white/10">
            <div className="text-[8px] font-black text-indigo-400 uppercase">TEAM ALPHA</div>
            <div className="text-xl font-black">{teamAlphaScore}</div>
          </div>
        </div>
      </div>

      <div className="absolute top-0 right-0 p-4 md:p-6 z-[150]">
        <button onClick={toggleMic} className={`glass-panel w-10 h-10 rounded-full flex items-center justify-center transition-all ${isMicActive ? 'mic-active' : 'text-white/50'}`}>
          {isMicActive ? '🎤' : '🎙️'}
        </button>
      </div>

      <div className={`felt-table w-[300px] h-[300px] md:w-[500px] md:h-[500px] rounded-full flex items-center justify-center ${isThunderActive ? 'thunder-active' : ''}`}>
        <div className="pile-indicator">
          <div className="w-20 h-20 rounded-full bg-black/60 border border-white/10 flex flex-col items-center justify-center backdrop-blur-md">
            <span className="text-[8px] font-black text-white/40 uppercase">Pile</span>
            <span className="text-2xl font-black text-white">{gameState.pile.length}</span>
          </div>
        </div>

        <div className="relative w-full h-full flex items-center justify-center">
          {gameState.currentTrick.map((t) => (
            <div key={t.playerId} className={`absolute animate-deal z-[50]`}>
              <CardComponent card={t.card} skin={profile.activeSkin} className="scale-75 md:scale-100" />
            </div>
          ))}
        </div>
      </div>

      <div className="card-wing-container">
        {playerHandSorted.map((card, idx) => {
          const isMyTurn = gameState.currentTurn === 0 && !isProcessing && gameState.currentTrick.length < 4;
          const isSelectable = isMyTurn && (!gameState.leadSuit || card.suit === gameState.leadSuit || !gameState.players[0].hand.some(c => c.suit === gameState.leadSuit));
          return (
            <div key={`${card.suit}-${card.rank}-${idx}`} className="wing-card">
              <CardComponent 
                card={card} 
                skin={profile.activeSkin} 
                onClick={() => playCard(0, card)} 
                disabled={!isSelectable && isMyTurn} 
              />
            </div>
          );
        })}
      </div>

      {trumpAlert && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 z-[2000] pointer-events-none">
          <div className="glass-panel p-4 px-8 rounded-3xl border-2 border-indigo-500/50 flex items-center gap-4 shadow-2xl animate-bounce">
            <span className="text-4xl text-indigo-400">{suitIcons[trumpAlert.suit]}</span>
            <div className="text-left">
              <div className="text-[8px] font-black text-indigo-400 uppercase tracking-widest">TRUMP ANNOUNCED</div>
              <div className="text-2xl font-black uppercase">{trumpAlert.suit}</div>
            </div>
          </div>
        </div>
      )}

      {gameState.roundStatus === 'ended' && (
        <div className="fixed inset-0 bg-black/95 z-[5000] flex flex-col items-center justify-center p-8 backdrop-blur-3xl text-center">
          <h2 className="text-5xl turab-title font-black italic mb-12">MATCH OVER</h2>
          <div className="w-full max-w-sm space-y-4">
            <button onClick={() => startNewGame('classic')} className="gold-button w-full py-6 rounded-3xl text-xl">Play Again</button>
            <button onClick={() => setView('home')} className="w-full py-5 bg-white/5 border border-white/10 rounded-3xl text-xs font-black uppercase text-white/40">Back to Lobby</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;