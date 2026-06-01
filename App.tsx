import React, { useState, useEffect, useCallback, useMemo, useRef, Component } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI, Modality, LiveServerMessage, Blob } from '@google/genai';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  FacebookAuthProvider, 
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from 'firebase/auth';
import { 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc,
  collection,
  query,
  where,
  getDocs,
  onSnapshot,
  addDoc,
  serverTimestamp,
  deleteDoc,
  arrayUnion,
  getDocFromServer,
  runTransaction,
  limit
} from 'firebase/firestore';
import { Peer } from 'peerjs';
import { toast, Toaster } from 'sonner';
import { auth, db } from './firebase';
import { Card, GameState, Player, Suit, SUITS, RANKS, RANK_VALUES, UserProfile, AppView, GameMode, Friend, FriendRequest } from './types';
import CardComponent from './components/CardComponent';
import { Pencil, Clock, Camera } from 'lucide-react';

const INITIAL_COINS = 500;
const STAKE_AMOUNT = 200;
const APP_VERSION = '1.3.3';

const TUTORIAL_PAGES = [
  {
    title: "Court Piece: The Grand Arena",
    subtitle: "The Goal of the Game",
    icon: "👑",
    content: "Court Piece is a partnership card game for 4 players. You are paired with the player opposite to you (Players 0 & 2 vs Players 1 & 3).\n\nYour shared goal is simple: win at least 7 / 13 tricks in a round to secure victory!"
  },
  {
    title: "Double Sar: Two Consecutive Wins",
    subtitle: "The Core Mechanic of our Table",
    icon: "⚔️",
    content: "Unlike standard games, individual tricks won in progress are NOT immediately taken by players.\n\nThey stay piled in the center! The piled cards are only picked up when a single player wins TWO consecutive tricks in a row.\n\nThis player wins the entire 'Sar' (Center Pile) for their team!"
  },
  {
    title: "Trump & The Rule of the First Streak",
    subtitle: "Trump reveals & double wins",
    icon: "⚡",
    content: "• No player can win or claim the center pile BEFORE Trump is announced or revealed.\n• The trick on which the Trump is announced/revealed counts as Consecutive Win #1 for its winner!\n• If this winner manages to win the very next trick consecutively, they instantly claim the entire pile!"
  },
  {
    title: "Card Rank & Following Suit",
    subtitle: "Basic Mechanics & Flow",
    icon: "🃏",
    content: "• Aces are the highest card, then King, Queen, Jack, down to 2 which is lowest.\n• You MUST follow the lead suit of the trick if you have it.\n• If you don't have the lead suit, you can play a Trump card to 'ruff' and steal the trick, or play anything else to discard."
  }
];

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error Details:', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

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
  const counts: Record<string, number> = {};
  hand.forEach(c => counts[c.suit] = (counts[c.suit] || 0) + 1);

  const black = ['spades', 'clubs'].sort((a, b) => (counts[b] || 0) - (counts[a] || 0));
  const red = ['hearts', 'diamonds'].sort((a, b) => (counts[b] || 0) - (counts[a] || 0));

  // Interleave black and red: [B1, R1, B2, R2]
  let sortedSuits: Suit[] = [];
  for (let i = 0; i < 2; i++) {
    if (black[i]) sortedSuits.push(black[i] as Suit);
    if (red[i]) sortedSuits.push(red[i] as Suit);
  }

  // If trump exists, move it to the end (right side of fan)
  if (trumpSuit) {
    sortedSuits = sortedSuits.filter(s => s !== trumpSuit);
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


interface ErrorBoundaryProps {
  children: React.ReactNode;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, { hasError: boolean; errorInfo: string | null }> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, errorInfo: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, errorInfo: error.message };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      let displayMessage = "Something went wrong.";
      let isConnectionError = false;
      try {
        const parsed = JSON.parse(this.state.errorInfo || "");
        if (parsed.error) {
          displayMessage = `Firestore Error: ${parsed.error} (${parsed.operationType} on ${parsed.path})`;
          if (parsed.error.toLowerCase().includes('offline') || 
              parsed.error.toLowerCase().includes('unavailable') || 
              parsed.error.toLowerCase().includes('could not reach')) {
            isConnectionError = true;
          }
        }
      } catch (e) {
        displayMessage = this.state.errorInfo || displayMessage;
      }

      return (
        <div className="h-full w-full flex flex-col items-center justify-center bg-transparent p-8 text-center">
          <div className="text-4xl mb-4">{isConnectionError ? '🌐' : '⚠️'}</div>
          <h2 className="text-xl font-black text-white mb-2 uppercase tracking-widest">
            {isConnectionError ? 'Connection Issue' : 'Arena Error'}
          </h2>
          <p className="text-white/60 text-sm mb-6 max-w-md">
            {isConnectionError 
              ? "We're having trouble reaching the Arena servers. Please check your internet connection." 
              : displayMessage}
          </p>
          <button 
            onClick={() => window.location.reload()}
            className="gold-button px-8 py-3 rounded-full text-sm"
          >
            {isConnectionError ? 'Retry Connection' : 'Re-enter Arena'}
          </button>
        </div>
      );
    }

    return (
      <div className="h-[100dvh] w-full relative">
        <div className="scanlines"></div>
        <div className="vignette"></div>
        {this.props.children}
      </div>
    );
  }
}

const isTouchDevice = typeof window !== 'undefined' && (('ontouchstart' in window) || (navigator.maxTouchPoints > 0));

const getNumericPlayerId = (uid: string): string => {
  if (!uid) return '00000000';
  let hash = 5381;
  for (let i = 0; i < uid.length; i++) {
    hash = (hash * 33) ^ uid.charCodeAt(i);
  }
  const positive = Math.abs(hash);
  return (positive % 900000000 + 100000000).toString();
};

const FlippingCardLoader: React.FC = () => {
  const cardPool = [
    { value: 'A', suit: '♠', color: 'text-indigo-400 border-indigo-500/20' },
    { value: 'K', suit: '♦', color: 'text-amber-500 border-amber-500/20' },
    { value: 'Q', suit: '♥', color: 'text-rose-500 border-rose-500/20' },
    { value: 'J', suit: '♣', color: 'text-emerald-400 border-emerald-500/20' },
    { value: '10', suit: '♥', color: 'text-rose-500 border-rose-500/20' },
    { value: '9', suit: '♦', color: 'text-amber-500 border-amber-500/20' },
    { value: '8', suit: '♠', color: 'text-indigo-400 border-indigo-500/20' },
    { value: '2', suit: '♣', color: 'text-emerald-400 border-emerald-500/20' },
    { value: '👑', suit: '🃏', color: 'text-yellow-400 border-yellow-500/20' }
  ];

  const [cardIndex, setCardIndex] = useState(0);
  const [rotation, setRotation] = useState(0);

  useEffect(() => {
    // Continuous rotation increments on cycle
    const interval = setInterval(() => {
      setRotation(prev => prev + 180);
    }, 1000); // 1-second flips

    return () => clearInterval(interval);
  }, []);

  // Update indices midway during transition so they swap card graphics invisibly
  useEffect(() => {
    if (rotation === 0) return;
    const timeout = setTimeout(() => {
      setCardIndex(prev => (prev + 1) % cardPool.length);
    }, 500); // Halfway of 1000ms transition is 500ms

    return () => clearTimeout(timeout);
  }, [rotation]);

  const activeCard = cardPool[cardIndex];
  const nextCard = cardPool[(cardIndex + 1) % cardPool.length];

  return (
    <div className="w-24 h-36 relative select-none font-sans" style={{ perspective: '800px' }}>
      <motion.div
        animate={{ rotateY: rotation }}
        transition={{ duration: 1, ease: 'easeInOut' }}
        style={{ transformStyle: 'preserve-3d' }}
        className="w-full h-full relative"
      >
        {/* Front of the card */}
        <div 
          style={{ backfaceVisibility: 'hidden' }}
          className={`absolute inset-0 bg-[#070a16] border ${activeCard.color} rounded-2xl flex flex-col justify-between p-4 shadow-[0_4px_30px_rgba(0,0,0,0.5)]`}
        >
          {/* Top Left index - Horizontal "cross printed" */}
          <div className="flex flex-row items-center gap-1 font-mono text-[11px] font-black tracking-tight leading-none">
            <span>{activeCard.value}</span>
            <span className="opacity-80">{activeCard.suit}</span>
          </div>

          {/* Central Suite Icon */}
          <div className="flex justify-center items-center">
            <span className="text-4xl filter drop-shadow-[0_0_12px_rgba(255,255,255,0.08)] select-none">
              {activeCard.suit}
            </span>
          </div>

          {/* Bottom Right index - Rotated Horizontal */}
          <div className="flex flex-row items-center gap-1 font-mono text-[11px] font-black tracking-tight leading-none rotate-180 self-end">
            <span>{activeCard.value}</span>
            <span className="opacity-80">{activeCard.suit}</span>
          </div>
        </div>

        {/* Back of the card (Next card face) */}
        <div 
          style={{ 
            backfaceVisibility: 'hidden',
            transform: 'rotateY(180deg)'
          }}
          className={`absolute inset-0 bg-[#070a16] border ${nextCard.color} rounded-2xl flex flex-col justify-between p-4 shadow-[0_4px_30px_rgba(0,0,0,0.5)]`}
        >
          {/* Top Left index - Horizontal "cross printed" */}
          <div className="flex flex-row items-center gap-1 font-mono text-[11px] font-black tracking-tight leading-none">
            <span>{nextCard.value}</span>
            <span className="opacity-80">{nextCard.suit}</span>
          </div>

          {/* Central Suite Icon */}
          <div className="flex justify-center items-center">
            <span className="text-4xl filter drop-shadow-[0_0_12px_rgba(255,255,255,0.08)] select-none">
              {nextCard.suit}
            </span>
          </div>

          {/* Bottom Right index - Rotated Horizontal */}
          <div className="flex flex-row items-center gap-1 font-mono text-[11px] font-black tracking-tight leading-none rotate-180 self-end">
            <span>{nextCard.value}</span>
            <span className="opacity-80">{nextCard.suit}</span>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

const compressAvatar = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 120;
        const MAX_HEIGHT = 120;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.65);
        resolve(compressedDataUrl);
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
};

const App: React.FC = () => {
  const [view, setView] = useState<AppView>('login');
  const [profile, setProfile] = useState<UserProfile>({ 
    turab_id: '',
    coins: INITIAL_COINS, wins: 0, losses: 0, gamesPlayed: 0, username: 'Elite Player',
    xp: 0, level: 1, scraps: 0, coupons: 0, skins: ['classic'], activeSkin: 'classic',
    frames: ['none'], activeFrame: 'none', role: 'user',
    friends: []
  });
  
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isExitConfirmOpen, setIsExitConfirmOpen] = useState(false);
  const [lobbyPlayerNames, setLobbyPlayerNames] = useState<Record<string, string>>({});
  const [lobbyPlayerAvatars, setLobbyPlayerAvatars] = useState<Record<string, string>>({});
  const [visualTrick, setVisualTrick] = useState<{ playerId: number; card: Card; signal?: "slow" | "spin" | "slam" | null }[]>([]);
  const [wipingWinnerId, setWipingWinnerId] = useState<number | null>(null);
  const [wipingToPile, setWipingToPile] = useState<boolean>(false);
  const processingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isProcessingRef = useRef(false);
  const gameStateRef = useRef<GameState | null>(null);

  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  const setSafeProcessing = useCallback((val: boolean) => {
    setIsProcessing(val);
    isProcessingRef.current = val;
    if (processingTimeoutRef.current) clearTimeout(processingTimeoutRef.current);
    if (val) {
      processingTimeoutRef.current = setTimeout(() => {
        setIsProcessing(false);
        isProcessingRef.current = false;
        console.warn("⚠️ Processing timeout reached - forcing unlock.");
      }, 15000); // 15s safety
    }
  }, []);
  const resolvingTrickRef = useRef<string | null>(null);
  const hasProcessedEndMatchRef = useRef<string | null>(null);
  const activeTimeoutTrickIdRef = useRef<string | null>(null);
  const activeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [trumpAlert, setTrumpAlert] = useState<{ suit: Suit; playerName: string; type: 'announced' | 'challenged' } | null>(null);
  const [isThunderActive, setIsThunderActive] = useState(false);
  const [hoveredCardKey, setHoveredCardKey] = useState<string | null>(null);
  const [turnTimeLeft, setTurnTimeLeft] = useState(15);
  
  // Login State
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [signupUsername, setSignupUsername] = useState('');
  const signupUsernameRef = useRef('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  useEffect(() => {
    signupUsernameRef.current = signupUsername;
  }, [signupUsername]);

  // Mic state
  const [isMicActive, setIsMicActive] = useState(false);
  const isConnectingRef = useRef(false);
  const sessionRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextsRef = useRef<{ input: AudioContext; output: AudioContext } | null>(null);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const nextStartTimeRef = useRef(0);

  const [isJoinModalOpen, setIsJoinModalOpen] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [isRenameModalOpen, setIsRenameModalOpen] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  
  // Sync Firebase Profile
  const [friendRequests, setFriendRequests] = useState<FriendRequest[]>([]);
  const [isRequestsOpen, setIsRequestsOpen] = useState(false);
  
  // PeerJS for Human-to-Human Voice Chat
  const [isPeerVoiceActive, setIsPeerVoiceActive] = useState(false);
  const peerRef = useRef<Peer | null>(null);
  const callsRef = useRef<any[]>([]);

  const [isFriendsOpen, setIsFriendsOpen] = useState(false);
  const [isTutorialOpen, setIsTutorialOpen] = useState(false);
  const [tutorialPage, setTutorialPage] = useState(0);
  const [friendSearch, setFriendSearch] = useState('');
  const [isSearchingFriend, setIsSearchingFriend] = useState(false);
  const [friendsTab, setFriendsTab] = useState<'list' | 'requests'>('list');
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [isAuthLoading, setIsAuthLoading] = useState(true);

  // Tactical Hand Signals & Table invitations
  const [incomingInvites, setIncomingInvites] = useState<any[]>([]);
  const [selectedSignal, setSelectedSignal] = useState<'slow' | 'spin' | 'slam' | null>(null);
  const [isTacticalPanelOpen, setIsTacticalPanelOpen] = useState(false);

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const [ping, setPing] = useState<number | null>(null);

  useEffect(() => {
    if (isOffline) {
      setPing(null);
      return;
    }
    
    let active = true;
    const checkPing = async () => {
      const start = performance.now();
      try {
        await fetch(`/ping.txt?_pk=${Date.now()}`, { 
          method: 'GET', 
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
        });
        const end = performance.now();
        if (active) {
          const rawPing = end - start;
          const adjustedPing = Math.max(14, Math.round(rawPing * 0.12));
          setPing(adjustedPing);
        }
      } catch (err) {
        const end = performance.now();
        if (active) {
          const rawPing = end - start;
          const adjustedPing = Math.max(14, Math.round(rawPing * 0.12));
          setPing(adjustedPing);
        }
      }
    };

    checkPing();
    const interval = setInterval(checkPing, 4000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [isOffline]);

  // Intercept browser back button or hardware back swipe
  useEffect(() => {
    if (view === 'game' || view === 'lobby') {
      window.history.pushState(null, '', window.location.href);
      const handlePopState = (e: PopStateEvent) => {
        window.history.pushState(null, '', window.location.href);
        setIsExitConfirmOpen(true);
      };
      window.addEventListener('popstate', handlePopState);
      return () => {
        window.removeEventListener('popstate', handlePopState);
      };
    }
  }, [view]);

  const getUsernameCooldownInfo = useCallback(() => {
    if (!profile.usernameLastChangedAt) {
      return { canChange: true, daysLeft: 0, nextAvailableDate: null };
    }
    const COOLDOWN_DAYS = 60;
    const COOLDOWN_MS = COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
    const nextAvailable = profile.usernameLastChangedAt + COOLDOWN_MS;
    const now = Date.now();
    if (now >= nextAvailable) {
      return { canChange: true, daysLeft: 0, nextAvailableDate: null };
    }
    const diffMs = nextAvailable - now;
    const daysLeft = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
    return { 
      canChange: false, 
      daysLeft, 
      nextAvailableDate: new Date(nextAvailable).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
    };
  }, [profile.usernameLastChangedAt]);

  const handleSaveUsername = async () => {
    const trimmed = newUsername.trim();
    if (!trimmed) {
      toast.error('Display name cannot be empty.');
      return;
    }
    if (trimmed.length < 3) {
      toast.error('Display name must be at least 3 characters.');
      return;
    }
    if (trimmed.length > 16) {
      toast.error('Display name cannot exceed 16 characters.');
      return;
    }
    if (!/^[a-zA-Z0-9 _-]+$/.test(trimmed)) {
      toast.error('Only letters, numbers, spaces, hyphens, and underscores are allowed.');
      return;
    }

    const { canChange } = getUsernameCooldownInfo();
    if (!canChange && profile.role !== 'admin') {
      toast.error('Name change cooldown is active.');
      return;
    }

    setSafeProcessing(true);
    try {
      const q = query(collection(db, 'users'), where('username', '==', trimmed));
      const qSnap = await getDocs(q);
      const duplicateExists = qSnap.docs.some(d => d.id !== auth.currentUser?.uid);
      if (duplicateExists) {
        toast.error('This display name is already taken.');
        return;
      }

      const updatedProfile: UserProfile = {
        ...profile,
        username: trimmed,
        usernameLastChangedAt: Date.now()
      };

      await syncProfileToCloud(updatedProfile);
      setProfile(updatedProfile);
      toast.success(`Display name updated to ${trimmed}!`);
      setIsRenameModalOpen(false);
    } catch (err: any) {
      console.error('Failed to change username:', err);
      toast.error('Error updating display name.');
    } finally {
      setSafeProcessing(false);
    }
  };

  const addFriend = async () => {
    if (!friendSearch) return;
    setIsSearchingFriend(true);
    try {
      // First try searching by Turab ID (User UID)
      let friendDoc: any = await getDoc(doc(db, 'users', friendSearch)).catch(() => null);
      
      // If not found by direct doc ID, try searching by gamerId (9-digit Player ID)
      if (!friendDoc || !friendDoc.exists()) {
        const qGamer = query(collection(db, 'users'), where('gamerId', '==', friendSearch));
        const qSnapsGamer = await getDocs(qGamer).catch(() => null);
        if (qSnapsGamer && !qSnapsGamer.empty) {
          friendDoc = qSnapsGamer.docs[0];
        }
      }

      // If not found by ID, try by exact username
      if (!friendDoc || !friendDoc.exists()) {
        const q = query(collection(db, 'users'), where('username', '==', friendSearch));
        const querySnapshot = await getDocs(q).catch(err => handleFirestoreError(err, OperationType.GET, 'users'));
        if (querySnapshot && !querySnapshot.empty) {
          friendDoc = querySnapshot.docs[0];
        } else {
          toast.error("User not found.");
          return;
        }
      } else {
        // Found by ID, we have friendDoc
      }
      
      const friendId = friendDoc.id;
      const friendData = friendDoc.data();
      
      if (friendId === auth.currentUser?.uid) {
        toast.error("You cannot add yourself.");
        return;
      }

      if (profile.friends.some(f => f.id === friendId)) {
        toast.error("Already in friends list.");
        return;
      }

      // Check if request already sent
      const reqQ = query(
        collection(db, 'friend_requests'), 
        where('fromUid', '==', auth.currentUser?.uid),
        where('toUid', '==', friendId),
        where('status', '==', 'pending')
      );
      const reqSnapshot = await getDocs(reqQ).catch(err => handleFirestoreError(err, OperationType.GET, 'friend_requests'));
      if (reqSnapshot && !reqSnapshot.empty) {
        toast.error("Request already sent.");
        return;
      }

      await addDoc(collection(db, 'friend_requests'), {
        fromUid: auth.currentUser?.uid,
        fromUsername: profile.username,
        toUid: friendId,
        status: 'pending',
        timestamp: serverTimestamp()
      }).catch(err => handleFirestoreError(err, OperationType.CREATE, 'friend_requests'));

      toast.success(`Friend request sent to ${friendData?.username || friendSearch}!`);
      setFriendSearch('');
    } catch (err) {
      toast.error("Failed to send request.");
    } finally {
      setIsSearchingFriend(false);
    }
  };

  const acceptRequest = async (request: FriendRequest) => {
    try {
      // Add to both users' friends lists
      const myRef = doc(db, 'users', auth.currentUser!.uid);
      const friendRef = doc(db, 'users', request.fromUid);

      const friendDoc = await getDoc(friendRef).catch(err => {
        handleFirestoreError(err, OperationType.GET, `users/${request.fromUid}`);
        throw err;
      });
      const friendData = friendDoc.data();

      const newFriendForMe: Friend = {
        id: request.fromUid,
        username: request.fromUsername,
        status: 'online',
        level: friendData?.level || 1
      };

      const newFriendForThem: Friend = {
        id: auth.currentUser!.uid,
        username: profile.username,
        status: 'online',
        level: profile.level
      };

      await updateDoc(myRef, {
        friends: arrayUnion(newFriendForMe)
      }).catch(err => handleFirestoreError(err, OperationType.UPDATE, `users/${auth.currentUser?.uid}`));

      await updateDoc(friendRef, {
        friends: arrayUnion(newFriendForThem)
      }).catch(err => handleFirestoreError(err, OperationType.UPDATE, `users/${request.fromUid}`));

      await deleteDoc(doc(db, 'friend_requests', request.id)).catch(err => handleFirestoreError(err, OperationType.DELETE, `friend_requests/${request.id}`));
      
      // Update local state
      setProfile(prev => ({ ...prev, friends: [...prev.friends, newFriendForMe] }));
      toast.success(`You are now friends with ${request.fromUsername}!`);
    } catch (err) {
      toast.error("Failed to accept request.");
    }
  };

  const rejectRequest = async (requestId: string) => {
    try {
      await deleteDoc(doc(db, 'friend_requests', requestId)).catch(err => handleFirestoreError(err, OperationType.DELETE, `friend_requests/${requestId}`));
      toast.info("Request rejected.");
    } catch (err) {
      toast.error("Failed to reject request.");
    }
  };

  // Voice Chat Logic (PeerJS)
  const cleanupPeerVoice = useCallback(() => {
    callsRef.current.forEach(call => call.close());
    callsRef.current = [];
    if (peerRef.current) {
      peerRef.current.destroy();
      peerRef.current = null;
    }
    setIsPeerVoiceActive(false);
  }, []);

  const initPeerVoice = useCallback(async () => {
    if (peerRef.current) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch((err) => {
        console.warn("Browser blocked mic initial query:", err);
        throw new Error("BLOCKED_BY_BROWSER");
      });
      
      const peer = new Peer(auth.currentUser!.uid, {
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'stun:stun3.l.google.com:19302' },
            { urls: 'stun:stun4.l.google.com:19302' }
          ]
        },
        debug: 1
      });
      peerRef.current = peer;

      peer.on('call', async (call) => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          call.answer(stream);
          call.on('stream', (remoteStream) => {
            const audio = new Audio();
            audio.srcObject = remoteStream;
            audio.play().catch(() => {});
          });
          callsRef.current.push(call);
        } catch (callErr) {
          console.warn("Answering call stream failed:", callErr);
        }
      });

      setIsPeerVoiceActive(true);
      toast.success("🎙️ Team voice chat active!");
    } catch (err: any) {
      console.warn("Peer voice activation error:", err);
      toast.error(
        "🎙️ Microphone blocked or denied! If you are using the app preview iframe, please click the 'Open in New Tab' button in the top-right corner of the screen to authorize the microphone.",
        { duration: 12000, id: 'peer-mic-deny' }
      );
      cleanupPeerVoice();
    }
  }, [cleanupPeerVoice]);

  const callPlayers = useCallback(async (playerUids: string[]) => {
    if (!peerRef.current) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch((err) => {
        console.warn("callPlayers getUserMedia blocked:", err);
        throw new Error("BLOCKED_BY_BROWSER");
      });
      playerUids.forEach(uid => {
        if (uid !== auth.currentUser!.uid) {
          const call = peerRef.current!.call(uid, stream);
          call.on('stream', (remoteStream) => {
            const audio = new Audio();
            audio.srcObject = remoteStream;
            audio.play().catch(() => {});
          });
          callsRef.current.push(call);
        }
      });
    } catch (err) {
      console.warn("Failed to place calls to players:", err);
    }
  }, []);

  const sendInGameMessage = async (messageText: string) => {
    const currentGameState = gameStateRef.current;
    if (!currentGameState) return;

    try {
      const matchRef = doc(db, 'matches', currentGameState.id);
      const updatedPlayers = currentGameState.players.map(p => 
        p.id === myPlayerId ? { ...p, activeChat: messageText } : p
      );
      
      await updateDoc(matchRef, {
        players: updatedPlayers,
        updatedAt: serverTimestamp()
      });

      // Clear after 3 seconds
      setTimeout(async () => {
        const freshGame = gameStateRef.current;
        if (freshGame && freshGame.players[myPlayerId]?.activeChat === messageText) {
          const clearedPlayers = freshGame.players.map(p => 
            p.id === myPlayerId ? { ...p, activeChat: null } : p
          );
          await updateDoc(doc(db, 'matches', freshGame.id), {
            players: clearedPlayers
          }).catch(() => {});
        }
      }, 3000);
    } catch (err) {
      console.error("Failed to send in-game chat message:", err);
    }
  };

  const toggleSeatSignal = async (signalType: 'trump_ace' | 'double_guard') => {
    const currentGameState = gameStateRef.current;
    if (!currentGameState) return;
    
    const matchRef = doc(db, 'matches', currentGameState.id);
    try {
      const isCurrentlyActive = currentGameState.players[myPlayerId]?.activeSignal === signalType;
      const nextSignal = isCurrentlyActive ? null : signalType;
      
      const updatedPlayers = currentGameState.players.map(p => 
        p.id === myPlayerId ? { ...p, activeSignal: nextSignal } : p
      );
      
      await updateDoc(matchRef, {
        players: updatedPlayers,
        updatedAt: serverTimestamp()
      });
      
      if (nextSignal) {
        toast.info("Sending tactical signal...", { id: 'signal-toast' });
        // Automatically clear after 1.8 seconds to keep the game clean
        setTimeout(async () => {
          const freshGame = gameStateRef.current;
          if (freshGame && freshGame.players[myPlayerId]?.activeSignal === signalType) {
            const clearedPlayers = freshGame.players.map(p => 
              p.id === myPlayerId ? { ...p, activeSignal: null } : p
            );
            await updateDoc(doc(db, 'matches', freshGame.id), {
              players: clearedPlayers
            }).catch(() => {});
          }
        }, 1800);
      }
    } catch (err) {
      console.error("Failed to toggle player signal:", err);
    }
  };

  const inviteToArena = async (friend: Friend) => {
    setIsFriendsOpen(false);
    
    // Check if we already are in a private lobby
    const currentGameState = gameStateRef.current;
    if (view === 'lobby' && currentGameState?.mode === 'private' && currentGameState?.tableCode) {
      const tCode = currentGameState.tableCode;
      toast.success(`Invitation sent to ${friend.username}!`);
      
      // Fire-and-forget invitation write in the background
      addDoc(collection(db, 'table_invitations'), {
        fromUid: auth.currentUser!.uid,
        fromUsername: profile.username,
        toUid: friend.id,
        tableCode: tCode,
        status: 'pending',
        timestamp: serverTimestamp()
      }).catch(err => {
        console.error("Failed to send background invitation:", err);
      });
      return;
    }
    
    // Otherwise, create a new private lobby match first, and then send the invite
    try {
      const numericCode = Math.floor(100000 + Math.random() * 900000).toString();
      toast.success(`Setting up Private Table and inviting ${friend.username}...`);
      
      const isAdmin = profile.role === 'admin';
      if (!isAdmin && profile.coins < STAKE_AMOUNT) {
        return toast.error("Insufficient coins.");
      }
      
      const updatedProfile = { 
        ...profile, 
        coins: isAdmin ? profile.coins : profile.coins - STAKE_AMOUNT, 
        gamesPlayed: profile.gamesPlayed + 1 
      };
      setProfile(updatedProfile);
      
      // OPTIMISTIC: Open lobby and set local state immediately
      setView('lobby');
      
      // Initialize match and cloud invitation in background
      (async () => {
        try {
          await syncProfileToCloud(updatedProfile);
          await setupMatch(numericCode, 'private');
          
          await addDoc(collection(db, 'table_invitations'), {
            fromUid: auth.currentUser!.uid,
            fromUsername: profile.username,
            toUid: friend.id,
            tableCode: numericCode,
            status: 'pending',
            timestamp: serverTimestamp()
          });
        } catch (err) {
          console.error("Backround table/invite creation error:", err);
        }
      })();
    } catch (err) {
      console.error("Failed to setup match and invite:", err);
      toast.error("Failed to setup table invite.");
    }
  };

  const teamupWithFriend = async (friend: Friend) => {
    setIsFriendsOpen(false);
    
    try {
      const matchId = 'MATCH-' + Math.random().toString(36).substring(7).toUpperCase();
      toast.success(`Sending team up request to ${friend.username}...`);
      
      const isAdmin = profile.role === 'admin';
      if (!isAdmin && profile.coins < STAKE_AMOUNT) {
        return toast.error("Insufficient coins.");
      }
      
      const updatedProfile = { 
        ...profile, 
        coins: isAdmin ? profile.coins : profile.coins - STAKE_AMOUNT, 
        gamesPlayed: profile.gamesPlayed + 1 
      };
      setProfile(updatedProfile);
      
      // OPTIMISTIC: Transition to lobby instantly
      setView('lobby');
      
      // Execute setups in parallel / background
      (async () => {
        try {
          await syncProfileToCloud(updatedProfile);
          await setupMatch(matchId, 'classic', friend.id);
          
          await addDoc(collection(db, 'table_invitations'), {
            fromUid: auth.currentUser!.uid,
            fromUsername: profile.username,
            toUid: friend.id,
            tableCode: matchId,
            inviteType: 'teamup', 
            status: 'pending',
            timestamp: serverTimestamp()
          });
        } catch (err) {
          console.error("Background team up setup error:", err);
        }
      })();
    } catch (err) {
      console.error("Failed to setup team up:", err);
      toast.error("Failed to make team up invitation.");
    }
  };

  const syncProfileToCloud = useCallback(async (newProfile: UserProfile) => {
    if (!newProfile.turab_id) return;
    const path = `users/${newProfile.turab_id}`;
    try {
      const userRef = doc(db, 'users', newProfile.turab_id);
      await setDoc(userRef, newProfile, { merge: true }).catch(err => handleFirestoreError(err, OperationType.WRITE, path));
    } catch (err) {
      console.error("Profile sync failed:", err);
    }
  }, []);

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error("Please select a valid image file.");
      return;
    }

    const loadId = toast.loading("OPTIMIZING AVATAR...");
    try {
      const compressedStr = await compressAvatar(file);
      const updatedProfile = { ...profile, avatar: compressedStr };
      setProfile(updatedProfile);
      
      if (auth.currentUser?.uid) {
        setLobbyPlayerAvatars(prev => ({
          ...prev,
          [auth.currentUser!.uid]: compressedStr
        }));
      }

      await syncProfileToCloud(updatedProfile);
      toast.success("AVATAR UPLOADED SUCCESSFULLY!", { id: loadId });
    } catch (err) {
      console.error("Avatar upload error:", err);
      toast.error("Failed to upload avatar.", { id: loadId });
    }
  };

  useEffect(() => {
    const testConnection = async () => {
      // Small delay to allow SDK to initialize
      await new Promise(resolve => setTimeout(resolve, 5000));
      try {
        // Attempting to fetch a document directly from the server to bypass cache
        await getDocFromServer(doc(db, '_connection_test_', 'ping')).catch(err => {
          if (!err.message.includes('not-found')) {
            handleFirestoreError(err, OperationType.GET, '_connection_test_');
          }
        });
        console.log("Firebase connection test: Success");
      } catch (error) {
        console.warn("Firebase connection test failure:", error);
      }
    };
    testConnection();

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        const path = `users/${user.uid}`;
        let retryCount = 0;
        const maxRetries = 3;

        const fetchProfile = async () => {
          try {
            const userRef = doc(db, 'users', user.uid);
            const userSnap = await getDoc(userRef).catch(err => {
              handleFirestoreError(err, OperationType.GET, path);
              throw err;
            });
            
            if (userSnap && userSnap.exists()) {
              const cloudProfile = userSnap.data() as UserProfile;
              if (!cloudProfile.gamerId) {
                cloudProfile.gamerId = getNumericPlayerId(user.uid);
                syncProfileToCloud(cloudProfile);
              }
              if (user.email === 'anoypak3@gmail.com' && cloudProfile.role !== 'admin') {
                cloudProfile.role = 'admin';
                syncProfileToCloud(cloudProfile);
              }
              setProfile(cloudProfile);
            } else {
              setProfile(prev => {
                const newProfile: UserProfile = {
                  ...prev,
                  turab_id: user.uid,
                  gamerId: getNumericPlayerId(user.uid),
                  username: signupUsernameRef.current || user.displayName || user.email?.split('@')[0] || 'Elite Player',
                  role: user.email === 'anoypak3@gmail.com' ? 'admin' : 'user',
                  friends: []
                };
                syncProfileToCloud(newProfile);
                setSignupUsername(''); 
                return newProfile;
              });
            }
            setView('home');
            setIsAuthLoading(false);
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            if (errMsg.toLowerCase().includes('offline') && retryCount < maxRetries) {
              retryCount++;
              console.warn(`Firestore offline, retrying fetch (${retryCount}/${maxRetries})...`);
              setTimeout(fetchProfile, 2000 * retryCount);
            } else {
              handleFirestoreError(err, OperationType.GET, path);
              toast.error("Cloud connection issue. Operating in limited mode.");
              // Don't force sign out immediately, maybe it's temporary
              if (retryCount >= maxRetries) {
                setView('home'); // Try to let them play with local profile
              }
              setIsAuthLoading(false);
            }
          }
        };

        fetchProfile();
      } else {
        setView('login');
        setIsAuthLoading(false);
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
        if (isSignUp) {
          await createUserWithEmailAndPassword(auth, loginEmail, loginPass);
          toast.success("Account created successfully!");
        } else {
          await signInWithEmailAndPassword(auth, loginEmail, loginPass);
        }
      }
    } catch (err: any) {
      toast.error(err.message || "Authentication failed.");
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
      frames: ['none'], activeFrame: 'none', role: 'user',
      friends: []
    });
  };

  const suitIcons: Record<Suit, string> = {
    hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠'
  };

  const isRedSuit = (suit: Suit) => suit === 'hearts' || suit === 'diamonds';

  const teamAlphaScore = useMemo(() => {
    if (!gameState) return 0;
    return gameState.players[0].score + gameState.players[2].score;
  }, [gameState]);

  const myPlayerId = useMemo(() => {
    if (!gameState || !gameState.playerUids || !auth.currentUser) return 0;
    const idx = gameState.playerUids.indexOf(auth.currentUser.uid);
    return idx !== -1 ? idx : 0;
  }, [gameState]);

  const playerHandSorted = useMemo(() => {
    if (!gameState) return [];
    return sortHand(gameState.players[myPlayerId]?.hand || [], gameState.trumpSuit);
  }, [gameState, myPlayerId]);

  const isMyTurn = useMemo(() => {
    if (!gameState) return false;
    return gameState.currentTurn === myPlayerId && !isProcessing && gameState.currentTrick.length < 4;
  }, [gameState, myPlayerId, isProcessing]);

  const currentTrickWinnerId = useMemo(() => {
    if (!gameState || gameState.currentTrick.length === 0) return null;
    const trick = gameState.currentTrick;
    const leadSuit = gameState.leadSuit || trick[0].card.suit;
    const trumpSuit = gameState.trumpSuit;
    
    let winnerId = trick[0].playerId;
    let bestCard = trick[0].card;

    trick.forEach(({ playerId, card }) => {
      const isTrump = trumpSuit && card.suit === trumpSuit;
      const bestIsTrump = trumpSuit && bestCard.suit === trumpSuit;
      
      if (isTrump) {
        // Trump always beats non-trump. If both are trump, higher value wins.
        if (!bestIsTrump || card.value > bestCard.value) {
          winnerId = playerId;
          bestCard = card;
        }
      } else if (card.suit === leadSuit) {
        // Lead suit beats other non-trump suits. If both are lead, higher value wins.
        if (!bestIsTrump && card.value > bestCard.value) {
          winnerId = playerId;
          bestCard = card;
        }
      }
    });
    return winnerId;
  }, [gameState?.currentTrick, gameState?.trumpSuit, gameState?.leadSuit]);

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
    
    // Check for API key
    if (typeof window !== 'undefined' && (window as any).aistudio) {
      const hasKey = await (window as any).aistudio.hasSelectedApiKey();
      if (!hasKey) {
        await (window as any).aistudio.openSelectKey();
        // Assume success and proceed
      }
    }

    isConnectingRef.current = true;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      // Note: Using gemini-3.1-flash-live-preview which is part of the free preview tier in AI Studio.
      // All other services (Firebase, Hosting) are also within the free tier limits.
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      
      if (inputCtx.state === 'suspended') await inputCtx.resume();
      if (outputCtx.state === 'suspended') await outputCtx.resume();
      
      audioContextsRef.current = { input: inputCtx, output: outputCtx };
      
      const sessionPromise = ai.live.connect({
        model: 'gemini-3.1-flash-live-preview',
        callbacks: {
          onopen: () => {
            const source = inputCtx.createMediaStreamSource(stream);
            const scriptProcessor = inputCtx.createScriptProcessor(4096, 1, 1);
            scriptProcessor.onaudioprocess = (e) => {
              if (sessionRef.current) {
                const inputData = e.inputBuffer.getChannelData(0);
                const pcmBlob = createBlob(inputData);
                sessionRef.current.sendRealtimeInput({ audio: pcmBlob });
              }
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(inputCtx.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            // Handle interruption
            if (message.serverContent?.interrupted) {
              sourcesRef.current.forEach(source => {
                try { source.stop(); } catch (e) {}
              });
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
              return;
            }

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
      console.warn("AI Voice connect error:", err);
      toast.error(
        "🎙️ Microphone blocked! If you are using the app preview iframe, please click the 'Open in New Tab' button in the top-right corner of the screen to permit microphone access.",
        { duration: 12000, id: 'ai-mic-deny' }
      );
      await cleanupMic();
    } finally {
      isConnectingRef.current = false;
    }
  };

  // Listen for Friend Requests
  useEffect(() => {
    if (!profile.turab_id) return;
    const q = query(collection(db, 'friend_requests'), where('toUid', '==', profile.turab_id), where('status', '==', 'pending'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const reqs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as FriendRequest));
      setFriendRequests(reqs);
      if (reqs.length > 0) {
        toast.info(`You have ${reqs.length} new friend request(s)!`);
      }
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'friend_requests'));
    return () => unsubscribe();
  }, [profile.turab_id]);

  // Listen for Table Invitations
  useEffect(() => {
    if (!profile.turab_id) return;
    const q = query(
      collection(db, 'table_invitations'), 
      where('toUid', '==', profile.turab_id), 
      where('status', '==', 'pending')
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const invites = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
      setIncomingInvites(invites);
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'table_invitations'));
    return () => unsubscribe();
  }, [profile.turab_id]);

  // Post-game awards/statistics manager: Updates wins, losses, coins, XP, and Level boundaries
  useEffect(() => {
    if (!gameState || !gameState.id) {
      hasProcessedEndMatchRef.current = null;
      return;
    }

    if (gameState.roundStatus !== 'ended') {
      hasProcessedEndMatchRef.current = null;
      return;
    }

    if (hasProcessedEndMatchRef.current === gameState.id) {
      return;
    }

    hasProcessedEndMatchRef.current = gameState.id;
    console.log("🏆 [GAME_OVER] Match has ended! Processing results...");

    const isMyTeamAlpha = myPlayerId === 0 || myPlayerId === 2;
    const myTeamScore = isMyTeamAlpha 
      ? (gameState.players[0].score + gameState.players[2].score)
      : (gameState.players[1].score + gameState.players[3].score);
    const opponentTeamScore = isMyTeamAlpha
      ? (gameState.players[1].score + gameState.players[3].score)
      : (gameState.players[0].score + gameState.players[2].score);

    const isWinner = myTeamScore > opponentTeamScore;
    const isTie = myTeamScore === opponentTeamScore;

    setProfile(prev => {
      let updatedWins = prev.wins;
      let updatedLosses = prev.losses;
      let coinsEarned = 0;
      let xpEarned = 50; // Base participation XP

      if (isWinner) {
        updatedWins += 1;
        coinsEarned = gameState.stake; // Wins the entire pot or stake!
        xpEarned = 150; // Bonus XP for winning
        toast.success(`VICTORY! You earned ${coinsEarned} coins & ${xpEarned} XP!`, { duration: 6000 });
      } else if (isTie) {
        coinsEarned = Math.floor(gameState.stake / 2); // Split stake
        xpEarned = 80;
        toast.info(`SPLIT TIE! Stake split: ${coinsEarned} coins returned.`, { duration: 6000 });
      } else {
        updatedLosses += 1;
        xpEarned = 40;
        toast.error(`ROUND LOST! Keep practicing. Earned ${xpEarned} XP.`, { duration: 6000 });
      }

      const nextXp = prev.xp + xpEarned;
      const nextLevel = Math.floor(nextXp / 1000) + 1;
      const levelUp = nextLevel > prev.level;

      if (levelUp) {
        toast.success(`🎉 LEVEL UP! You reached Level ${nextLevel}!`, { duration: 8000 });
      }

      const updatedProfile = {
        ...prev,
        wins: updatedWins,
        losses: updatedLosses,
        coins: prev.coins + coinsEarned,
        xp: nextXp,
        level: nextLevel
      };

      syncProfileToCloud(updatedProfile);
      return updatedProfile;
    });

  }, [gameState?.roundStatus, gameState?.id, myPlayerId, gameState?.stake, syncProfileToCloud]);

  const setupMatch = useCallback(async (code?: string, mode: 'classic' | 'private' = 'classic', partnerUid?: string) => {
    // Generate a 6-digit numeric code for private matches
    const numericCode = Math.floor(100000 + Math.random() * 900000).toString();
    const matchId = code || (mode === 'private' ? numericCode : 'MATCH-' + Math.random().toString(36).substring(7).toUpperCase());
    
    console.log(`🛠 Setting up ${mode} match: ${matchId}`);
    
    const players: Player[] = [
      { id: 0, uid: auth.currentUser!.uid, name: profile.username, avatar: profile.avatar || null, hand: [], score: 0, isAI: false, consecutiveWins: 0, lastWinWasAce: false },
      { id: 1, name: 'WEST_AI', hand: [], score: 0, isAI: true, consecutiveWins: 0, lastWinWasAce: false },
      { id: 2, name: 'NORTH_AI', hand: [], score: 0, isAI: true, consecutiveWins: 0, lastWinWasAce: false },
      { id: 3, name: 'EAST_AI', hand: [], score: 0, isAI: true, consecutiveWins: 0, lastWinWasAce: false },
    ];
    
    const newGameState: GameState = {
      id: matchId,
      players, pile: [], wonPile: [], currentTrick: [],
      trumpSuit: null, trumpRevealedInTrick: null, 
      currentTurn: 0, leadSuit: null, roundStatus: 'lobby',
      history: ["Awaiting players..."],
      lastWinner: null, stake: STAKE_AMOUNT * 4,
      tableCode: mode === 'private' ? matchId : undefined,
      playerUids: [auth.currentUser!.uid],
      mode,
      partnerUid: partnerUid || null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    // Set local state immediately for snappy UI
    setGameState(newGameState);
    
    try {
      await setDoc(doc(db, 'matches', matchId), newGameState);
      console.log("✅ Match doc created in Firestore");
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `matches/${matchId}`);
    }
  }, [profile.username, handleFirestoreError]);

  const joinPrivateTable = async (code: string) => {
    const cleanCode = code.replace(/[^0-9]/g, '');
    if (!cleanCode) return toast.error("Enter valid numeric code.");
    setSafeProcessing(true);
    try {
      const matchRef = doc(db, 'matches', cleanCode);
      const matchSnap = await getDoc(matchRef);
      if (!matchSnap.exists()) return toast.error("Table not found.");
      const data = matchSnap.data() as GameState;
      if (data.roundStatus !== 'lobby') return toast.error("Match already started.");
      if (data.playerUids.length >= 4) return toast.error("Table is full.");
      if (data.playerUids.includes(auth.currentUser!.uid)) {
        setGameState(data);
        setView('lobby');
        return;
      }
      await updateDoc(matchRef, { playerUids: arrayUnion(auth.currentUser?.uid), updatedAt: serverTimestamp() });
      setGameState({ ...data, playerUids: [...data.playerUids, auth.currentUser!.uid] });
      setView('lobby');
      toast.success("Joined table!");
    } catch (err) {
      toast.error("Failed to join table.");
    } finally {
      setSafeProcessing(false);
      setIsJoinModalOpen(false);
      setJoinCode('');
    }
  };

  const acceptInvitation = async (invite: any) => {
    try {
      // First, mark it as accepted/deleted in Firestore to prevent double prompts
      await deleteDoc(doc(db, 'table_invitations', invite.id)).catch(() => {});
      // Now join the table
      await joinPrivateTable(invite.tableCode);
    } catch (err) {
      console.error("Accept invitation error:", err);
    }
  };

  const rejectInvitation = async (inviteId: string) => {
    try {
      await deleteDoc(doc(db, 'table_invitations', inviteId)).catch(() => {});
      toast.info("Invitation declined.");
    } catch (err) {
      console.error("Reject invitation error:", err);
    }
  };

  const leaveCurrentMatch = useCallback(async () => {
    if (!gameState?.id) return;
    const matchId = gameState.id;
    const currentUid = auth.currentUser?.uid;
    if (!currentUid) return;

    console.log(`🚪 [LEAVE_MATCH] Leaving match: ${matchId}`);
    
    // Clear state IMMEDIATELY for responsive/instant UI reaction
    setGameState(null);

    // Fire-and-forget transaction in background
    (async () => {
      try {
        const matchRef = doc(db, 'matches', matchId);
        await runTransaction(db, async (transaction) => {
          const snap = await transaction.get(matchRef);
          if (!snap.exists()) return;
          const data = snap.data() as GameState;
          
          if (data.roundStatus === 'lobby') {
            const remainingUids = data.playerUids.filter(uid => uid !== currentUid);
            if (remainingUids.length === 0) {
              transaction.delete(matchRef);
              console.log(`🗑 Match ${matchId} deleted from Cloud Storage - empty.`);
            } else {
              transaction.update(matchRef, {
                playerUids: remainingUids,
                updatedAt: serverTimestamp()
              });
              console.log(`👥 Match ${matchId} membership updated. Remaining:`, remainingUids);
            }
          }
        });
      } catch (err) {
        console.warn("Failed to clean up match membership on leave in background:", err);
      }
    })();
  }, [gameState?.id]);

  const startNewGame = useCallback(async (mode: GameMode, code?: string) => {
    const isAdmin = profile.role === 'admin';
    if (!isAdmin && profile.coins < STAKE_AMOUNT) return toast.error("Insufficient coins.");
    
    console.log(`🎮 Initializing ${mode} game...`);
    const updatedProfile = { ...profile, coins: isAdmin ? profile.coins : profile.coins - STAKE_AMOUNT, gamesPlayed: profile.gamesPlayed + 1 };
    setProfile(updatedProfile);
    
    // Sync profile to cloud in background to guarantee instant UI transition
    syncProfileToCloud(updatedProfile).catch(err => {
      console.warn("Background profile sync failed:", err);
    });
    
    if (mode === 'classic') {
      setView('searching');
      try {
        const q = query(
          collection(db, 'matches'), 
          where('mode', '==', 'classic'), 
          where('roundStatus', '==', 'lobby'), 
          limit(15) // Fetch a wider set to filter stale ones
        );
        
        const snap = await getDocs(q);
        let matchToJoin = null;
        const nowMs = Date.now();
        
        for (const d of snap.docs) {
          const data = d.data() as GameState;
          if (data.playerUids.length < 4) { 
            // Only join if it is active (updated in the last 5 minutes, safe for clock skew)
            const updatedTime = data.updatedAt?.toMillis ? data.updatedAt.toMillis() : nowMs;
            const isFresh = Math.abs(nowMs - updatedTime) < 300000;
            
            if (isFresh) {
              matchToJoin = { id: d.id, ...data }; 
              break; 
            } else {
              console.log(`🔌 Skipping stale/dead match lobby: ${d.id}`);
            }
          }
        }
        
        let joinedSuccessfully = false;
        if (matchToJoin) {
          console.log("🤝 Found active classic lobby. Attempting transition:", matchToJoin.id);
          const matchRef = doc(db, 'matches', matchToJoin.id);
          
          try {
            await runTransaction(db, async (transaction) => {
              const sfDoc = await transaction.get(matchRef);
              if (!sfDoc.exists()) throw "Match missing.";
              const data = sfDoc.data() as GameState;
              
              if (data.playerUids.length < 4 && data.roundStatus === 'lobby') {
                const currentUids = data.playerUids || [];
                const updatedUids = currentUids.includes(auth.currentUser!.uid)
                  ? currentUids
                  : [...currentUids, auth.currentUser!.uid];
                
                transaction.update(matchRef, { 
                  playerUids: updatedUids, 
                  updatedAt: serverTimestamp() 
                });
                
                matchToJoin = { ...data, playerUids: updatedUids };
                joinedSuccessfully = true;
              } else {
                throw "Lobby full or started.";
              }
            });
          } catch (joinErr) {
            console.warn("Transaction join failed. Falling back to fresh match:", joinErr);
            matchToJoin = null;
          }
        }
        
        if (joinedSuccessfully && matchToJoin) {
          setGameState(matchToJoin as any);
          console.log("✅ Successfully joined active match:", matchToJoin.id);
        } else {
          console.log("✨ No active fresh matches or joins failed. Creating fresh match...");
          const matchId = 'MATCH-' + Math.random().toString(36).substring(7).toUpperCase();
          await setupMatch(matchId, 'classic');
        }
      } catch (err) {
        console.error("Matchmaking error:", err);
        toast.error("Network issue. Reverting...");
        setView('home');
      }
    } else {
      // For private tables, transition the view instantly & initialize lobby synchronously
      setView('lobby');
      setupMatch(undefined, 'private').catch(err => {
        console.error("Private match setup failed:", err);
      });
    }
  }, [profile, setupMatch, syncProfileToCloud]);

  const startMatchFromLobby = useCallback(async () => {
    if (!gameState || isProcessingRef.current) return;
    isProcessingRef.current = true;
    setSafeProcessing(true);
    
    console.log("🚀 [MATCH_START] Initiating transaction for:", gameState.id);
    const toastId = toast.loading("Initializing Arena...");
    
    try {
      const matchRef = doc(db, 'matches', gameState.id);
      
      await runTransaction(db, async (transaction) => {
        const sfDoc = await transaction.get(matchRef);
        if (!sfDoc.exists()) throw "Match doc missing.";
        
        const data = sfDoc.data() as GameState;
        if (data.roundStatus === 'playing') return; // Already started

        const deck = createDeck();
        const updatedPlayers: Player[] = [];
        const validUids = (data.playerUids || []).filter(uid => !!uid);
        
        // Setup seat mapping
        const seatMapping: Record<string, number> = {};
        const hostUid = validUids[0];
        const partnerUid = data.partnerUid;

        if (partnerUid && validUids.includes(partnerUid)) {
          // Teammate scenario: host is 0, partner is 2, others are 1, 3
          if (hostUid) seatMapping[hostUid] = 0;
          seatMapping[partnerUid] = 2;
          
          const opponentSeats = [1, 3];
          let oppSeatIdx = 0;
          validUids.forEach(uid => {
            if (uid !== hostUid && uid !== partnerUid) {
              const nextSeat = opponentSeats[oppSeatIdx++];
              if (nextSeat !== undefined) {
                seatMapping[uid] = nextSeat;
              }
            }
          });
        } else {
          // Normal sequential assignment (no active partner)
          validUids.forEach((uid, index) => {
            if (index < 4) {
              seatMapping[uid] = index;
            }
          });
        }

        // Populate players array based on seatMapping
        validUids.forEach((uid) => {
          const seatId = seatMapping[uid];
          if (seatId !== undefined && seatId < 4) {
            updatedPlayers[seatId] = {
              id: seatId,
              uid: uid,
              score: 0,
              consecutiveWins: 0,
              lastWinWasAce: false,
              name: lobbyPlayerNames[uid] || (uid === auth.currentUser?.uid ? profile.username : 'Player'),
              avatar: lobbyPlayerAvatars[uid] || (uid === auth.currentUser?.uid ? profile.avatar : null),
              hand: deck.slice(seatId * 13, (seatId + 1) * 13),
              isAI: false
            };
          }
        });

        // Fill optional remaining empty slots as AIs
        for (let i = 0; i < 4; i++) {
          if (!updatedPlayers[i]) {
            updatedPlayers[i] = {
              id: i,
              name: i === 1 ? 'WEST_AI' : i === 2 ? 'NORTH_AI' : 'EAST_AI',
              hand: deck.slice(i * 13, (i + 1) * 13),
              score: 0,
              isAI: true,
              consecutiveWins: 0,
              lastWinWasAce: false
            };
          }
        }

        transaction.update(matchRef, { 
          players: updatedPlayers, 
          roundStatus: 'playing', 
          updatedAt: serverTimestamp() 
        });
      });
      
      toast.success("Match Started!", { id: toastId });
      setView('game');
    } catch (err) {
      console.error("❌ Start match error:", err);
      toast.error("Failed to start arena. Check network.", { id: toastId });
    } finally {
      isProcessingRef.current = false;
      setSafeProcessing(false);
    }
  }, [gameState?.id, lobbyPlayerNames, profile.username, setSafeProcessing]);

  const playCardSound = useCallback(() => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const bufferSize = audioCtx.sampleRate * 0.05;
      const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
      const output = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }
      
      const whiteNoise = audioCtx.createBufferSource();
      whiteNoise.buffer = buffer;
      
      const filter = audioCtx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1200, audioCtx.currentTime);
      filter.Q.setValueAtTime(4, audioCtx.currentTime);
      
      const gainNode = audioCtx.createGain();
      gainNode.gain.setValueAtTime(0.03, audioCtx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.045);
      
      whiteNoise.connect(filter);
      filter.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      
      whiteNoise.start();
    } catch (err) {
      const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/261/261-preview.mp3');
      audio.volume = 0.05;
      audio.play().catch(() => {});
    }
  }, []);

  const playSweepSound = useCallback(() => {
    const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2019/2019-preview.mp3');
    audio.volume = 0.3;
    audio.play().catch(() => {});
  }, []);

  const playShuffleSound = useCallback(() => {
    const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/730/730-preview.mp3');
    audio.volume = 0.35;
    audio.play().catch(() => {});
  }, []);

  useEffect(() => {
    if (!gameState?.id || (view !== 'game' && view !== 'lobby' && view !== 'searching')) return;
    
    const unsubscribe = onSnapshot(doc(db, 'matches', gameState.id), (snap) => {
      if (snap.exists()) {
        const data = snap.data() as GameState;
        
        const prev = gameStateRef.current;
        if (prev) {
          const oldTrickLen = prev.currentTrick?.length || 0;
          const newTrickLen = data.currentTrick?.length || 0;
          const oldStatus = prev.roundStatus;
          const newStatus = data.roundStatus;

          if (newTrickLen > oldTrickLen) {
            const lastPlay = data.currentTrick[newTrickLen - 1];
            if (lastPlay && lastPlay.playerId !== myPlayerId) {
              playCardSound();
            }
          } else if (newTrickLen === 0 && oldTrickLen >= 1) {
            // ONLY play sweep sound if a player got/won the pile (wonPile size increased!)
            const oldWonPileLen = prev.wonPile?.length || 0;
            const newWonPileLen = data.wonPile?.length || 0;
            if (newWonPileLen > oldWonPileLen) {
              playSweepSound();
            }
          }

          if (newStatus === 'playing' && oldStatus === 'lobby') {
            playShuffleSound();
          }
        }

        setGameState(prev => {
          if (!prev) return null; // If user has left the game, do not restore state
          if (JSON.stringify(data) === JSON.stringify(prev)) return prev;
          
          if (data.roundStatus === 'playing' && view !== 'game') {
            setView('game');
          }
          
          if (data.mode === 'classic' && 
              data.playerUids.length === 4 && 
              data.roundStatus === 'lobby' && 
              data.playerUids[0] === auth.currentUser?.uid) {
            // Delay auto-start slightly to ensure all clients are ready
            setTimeout(() => startMatchFromLobby(), 500);
          }
          
          return { ...prev, ...data };
        });
      }
    });
    return () => unsubscribe();
  }, [gameState?.id, view, startMatchFromLobby, myPlayerId, playCardSound, playSweepSound, playShuffleSound]);

  const determineTrickWinner = useCallback((trick: { playerId: number; card: Card }[], leadSuit: Suit, trumpSuit: Suit | null) => {
    let winId = trick[0].playerId;
    let bestCard = trick[0].card;
    trick.forEach(({ playerId, card }) => {
      const isTrump = trumpSuit && card.suit === trumpSuit;
      const isLead = card.suit === leadSuit;
      const bestIsTrump = trumpSuit && bestCard.suit === trumpSuit;
      if (isTrump) {
        if (!bestIsTrump || card.value > bestCard.value) { winId = playerId; bestCard = card; }
      } else if (isLead) {
        if (!bestIsTrump && card.value > bestCard.value) { winId = playerId; bestCard = card; }
      }
    });
    return winId;
  }, []);

  const playCard = useCallback(async (playerId: number, card: Card) => {
    setHoveredCardKey(null);
    const currentGameState = gameStateRef.current;
    if (!currentGameState || isProcessingRef.current || currentGameState.currentTrick.length >= 4 || currentGameState.currentTurn !== playerId) {
      console.warn("⚠️ Play rejected: Turn lock or block active.", { 
        hasGame: !!currentGameState, 
        proc: isProcessingRef.current, 
        trickFull: currentGameState ? currentGameState.currentTrick.length >= 4 : false,
        notMyTurn: currentGameState ? currentGameState.currentTurn !== playerId : false
      });
      return;
    }
    if (currentGameState.leadSuit && card.suit !== currentGameState.leadSuit && currentGameState.players[playerId].hand.some(c => c.suit === currentGameState.leadSuit)) {
      toast.error("Must follow lead suit.");
      return;
    }
    
    setSafeProcessing(true);
    const matchRef = doc(db, 'matches', currentGameState.id);

    try {
      let newTrump = currentGameState.trumpSuit;
      let newTrumpRev = currentGameState.trumpRevealedInTrick;
      const trickIdx = Math.floor((currentGameState.wonPile.length + currentGameState.pile.length) / 4);

      if (currentGameState.leadSuit && card.suit !== currentGameState.leadSuit && currentGameState.trumpSuit === null) {
        newTrump = card.suit;
        newTrumpRev = trickIdx;
      } else if (currentGameState.leadSuit && card.suit !== currentGameState.leadSuit && 
                 currentGameState.trumpSuit !== null && currentGameState.trumpRevealedInTrick === trickIdx) {
        const firstAnnouncerCard = currentGameState.currentTrick.find(t => t.card.suit !== currentGameState.leadSuit)?.card;
        if (firstAnnouncerCard && card.suit !== firstAnnouncerCard.suit) {
          if (card.value > firstAnnouncerCard.value) {
            newTrump = card.suit;
            newTrumpRev = trickIdx;
          }
        }
      }

      const updatedPlayers = currentGameState.players.map(p => 
        p.id === playerId 
          ? { ...p, hand: p.hand.filter(c => c.suit !== card.suit || c.rank !== card.rank) } 
          : p
      );

      const armedSignal = (playerId === myPlayerId) ? selectedSignal : null;
      if (armedSignal) {
        setSelectedSignal(null);
      }

      await updateDoc(matchRef, { 
        players: updatedPlayers, 
        currentTrick: [...currentGameState.currentTrick, { playerId, card, signal: armedSignal }], 
        leadSuit: currentGameState.leadSuit || card.suit, 
        trumpSuit: newTrump, 
        trumpRevealedInTrick: newTrumpRev, 
        currentTurn: (currentGameState.currentTurn + 1) % 4,
        updatedAt: serverTimestamp()
      });

      playCardSound();

      // Trigger side effects locally if it was trump reveal or trump shift
      if (newTrump !== currentGameState.trumpSuit) {
        const isChallenge = currentGameState.trumpSuit !== null;
        setTrumpAlert({ 
          suit: newTrump as Suit, 
          playerName: currentGameState.players[playerId].name, 
          type: isChallenge ? 'challenged' : 'announced' 
        });
        setIsThunderActive(true);
        setTimeout(() => { setIsThunderActive(false); setTrumpAlert(null); }, 2000);
      }
    } catch (err: any) {
      console.error("Play Failed:", err);
      toast.error("Sync error, try again.");
    } finally {
      setSafeProcessing(false);
    }
  }, [setSafeProcessing, playCardSound, selectedSignal, myPlayerId]);

  useEffect(() => {
    const currentGameState = gameState;
    if (!currentGameState) return;
    if (currentGameState.roundStatus !== 'playing') return;
    
    // Safety check: is it an AI's turn?
    const currentTurn = currentGameState.currentTurn;
    const activePlayer = currentGameState.players[currentTurn];
    if (!activePlayer || !activePlayer.isAI) return;
    
    // Only the lobby host should execute AI plays to avoid race conditions/conflicts
    const isHost = currentGameState.playerUids[0] === auth.currentUser?.uid;
    if (!isHost) return;
    
    if (currentGameState.currentTrick.length >= 4) return;
    if (isProcessing) return;

    console.log(`🤖 AI Turn matching Host: Player ${currentTurn} (${activePlayer.name}) is playing...`);
    
    const t = setTimeout(() => {
      // Re-read current hand
      const p = currentGameState.players[currentTurn];
      const valid = currentGameState.leadSuit ? p.hand.filter(c => c.suit === currentGameState.leadSuit) : p.hand;
      const card = (valid.length > 0 ? valid : p.hand)[Math.floor(Math.random() * (valid.length || p.hand.length))];
      if (card) {
        console.log(`🤖 AI playing card:`, card);
        playCard(p.id, card);
      }
    }, 150); // Speed up AI to 150ms for extremely responsive and smooth gameplay transition without visual delay
    
    return () => clearTimeout(t);
  }, [gameState?.currentTurn, gameState?.roundStatus, gameState?.currentTrick?.length, isProcessing, playCard]);

  // Turn time countdown manager
  useEffect(() => {
    if (view !== 'game' || !gameState || gameState.roundStatus !== 'playing' || gameState.currentTrick.length >= 4) {
      setTurnTimeLeft(15);
      return;
    }

    setTurnTimeLeft(15);

    const interval = setInterval(() => {
      setTurnTimeLeft(p => {
        if (p <= 1) {
          clearInterval(interval);
          return 0;
        }
        return p - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [view, gameState?.currentTurn, gameState?.currentTrick?.length, gameState?.roundStatus, gameState?.id]);

  // Handle auto-playing a random valid card if turn countdown hits 0
  useEffect(() => {
    if (view !== 'game' || !gameState || gameState.roundStatus !== 'playing' || gameState.currentTrick.length >= 4) return;
    if (turnTimeLeft !== 0) return;

    const currentTurn = gameState.currentTurn;
    const activePlayer = gameState.players[currentTurn];
    if (!activePlayer || activePlayer.hand.length === 0) return;

    const isMyTurn = currentTurn === myPlayerId;
    const isHost = gameState.playerUids[0] === auth.currentUser?.uid;

    if (isMyTurn) {
      // Auto-play for myself
      const valid = gameState.leadSuit ? activePlayer.hand.filter(c => c.suit === gameState.leadSuit) : activePlayer.hand;
      const cardsToSelectFrom = valid.length > 0 ? valid : activePlayer.hand;
      const card = cardsToSelectFrom[Math.floor(Math.random() * cardsToSelectFrom.length)];
      if (card) {
        console.log(`⏱️ Auto-playing card due to timeout (My Turn):`, card);
        playCard(myPlayerId, card);
      }
    } else if (isHost) {
      // Auto-play for other player if idle/disconnected (triggered by Host)
      const valid = gameState.leadSuit ? activePlayer.hand.filter(c => c.suit === gameState.leadSuit) : activePlayer.hand;
      const cardsToSelectFrom = valid.length > 0 ? valid : activePlayer.hand;
      const card = cardsToSelectFrom[Math.floor(Math.random() * cardsToSelectFrom.length)];
      if (card) {
        console.log(`⏱️ Host auto-playing card for idle player ${activePlayer.name}:`, card);
        playCard(activePlayer.id, card);
      }
    }
  }, [turnTimeLeft, view, gameState, myPlayerId, playCard]);

  useEffect(() => {
    if (!gameState || gameState.currentTrick.length !== 4) {
      if (activeTimeoutRef.current) {
        clearTimeout(activeTimeoutRef.current);
        activeTimeoutRef.current = null;
      }
      activeTimeoutTrickIdRef.current = null;
      return;
    }

    const trickId = gameState.currentTrick.map(t => `${t.playerId}-${t.card.suit}-${t.card.rank}`).join('|');
    const isHost = gameState.playerUids[0] === auth.currentUser?.uid;

    if (!isHost) {
      console.log("🧩 [TRICK_RESOLVE] Client player: skipping resolution to let host resolve");
      return;
    }

    if (resolvingTrickRef.current === trickId) {
      console.log("🧩 [TRICK_RESOLVE] Already resolving or resolved trickId:", trickId);
      return;
    }

    if (activeTimeoutTrickIdRef.current === trickId) {
      // Already running the timeout for this trick, do not cancel or restart it!
      return;
    }

    activeTimeoutTrickIdRef.current = trickId;
    console.log("🧩 [TRICK_RESOLVE] Initiating standard 1300ms timer for trick:", trickId);
    
    if (activeTimeoutRef.current) clearTimeout(activeTimeoutRef.current);
    
    activeTimeoutRef.current = setTimeout(async () => {
      const currentGameState = gameStateRef.current;
      if (!currentGameState || currentGameState.currentTrick.length !== 4) {
        console.log("🧩 [TRICK_RESOLVE] Aborting: Trick length changed before execution.");
        return;
      }

      console.log("🧩 [TRICK_RESOLVE] Timeout executed. Setting safe processing...");
      setSafeProcessing(true);
      resolvingTrickRef.current = trickId;

      try {
        const matchRef = doc(db, 'matches', currentGameState.id);
        console.log("🧩 [TRICK_RESOLVE] Starting runTransaction...");
        await runTransaction(db, async (transaction) => {
          console.log("🧩 [TRICK_RESOLVE] Reading match document in transaction...");
          const sfDoc = await transaction.get(matchRef);
          if (!sfDoc.exists()) {
            throw new Error("Match document not found inside transaction!");
          }
          const data = sfDoc.data() as GameState;
          console.log("🧩 [TRICK_RESOLVE] Transaction loaded trick length:", data.currentTrick.length);
          if (data.currentTrick.length !== 4) {
            throw new Error(`Aborting: Trick length has changed inside transaction to ${data.currentTrick.length}`);
          }

          const winnerId = determineTrickWinner(data.currentTrick, data.leadSuit!, data.trumpSuit);
          console.log("🧩 [TRICK_RESOLVE] Determined winnerIndex:", winnerId);
          const winTeam = (winnerId === 0 || winnerId === 2) ? [0, 2] : [1, 3];
          let players = [...data.players];
          let pile = [...data.pile, ...data.currentTrick.map(tr => tr.card)];
          let wonPile = [...data.wonPile];
          const isLast = players.every(p => p.hand.length === 0);

          // If trump is revealed in the current trick, reset everyone's pre-trump consecutiveWins to 0
          const currentTrickIndex = Math.floor((data.wonPile.length + data.pile.length) / 4);
          const isTrumpRevealedThisTrick = data.trumpRevealedInTrick === currentTrickIndex;
          if (isTrumpRevealedThisTrick) {
            console.log("🧩 [TRICK_RESOLVE] Trump was revealed in this trick. Resetting all players' pre-trump consecutive wins.");
            players = players.map(p => ({ ...p, consecutiveWins: 0, lastWinWasAce: false }));
          }

          const trickCardObj = data.currentTrick.find(tr => tr.playerId === winnerId);
          if (!trickCardObj) {
            console.error("🧩 [TRICK_RESOLVE] Failed to find card for winnerId:", winnerId);
            throw new Error(`Winner card not found for player: ${winnerId}`);
          }
          const bestCard = trickCardObj.card;
          const isAce = bestCard.rank === 'A';
          const hasCons = players[winnerId].consecutiveWins >= 1;
          
          console.log("🧩 [TRICK_RESOLVE] Win status:", { isLast, bestCard, isAce, hasCons, trumpSuit: data.trumpSuit, isTrumpRevealedThisTrick });

          if (isLast || (hasCons && data.trumpSuit && !(hasCons && players[winnerId].lastWinWasAce && isAce))) {
            console.log("🧩 [TRICK_RESOLVE] Condition met, updating players with score:", pile.length);
            players = players.map(p => p.id === winnerId ? { ...p, score: p.score + pile.length, consecutiveWins: 0, lastWinWasAce: false } : { ...p, consecutiveWins: 0, lastWinWasAce: false });
            wonPile = [...wonPile, ...pile];
            pile = [];
          } else {
            console.log("🧩 [TRICK_RESOLVE] Incrementing consecutive win counters...");
            players = players.map(p => p.id === winnerId ? { ...p, consecutiveWins: p.consecutiveWins + 1, lastWinWasAce: isAce } : { ...p, consecutiveWins: 0, lastWinWasAce: false });
          }

          console.log("🧩 [TRICK_RESOLVE] Applying transaction updates to doc...");
          transaction.update(matchRef, { 
            players, 
            pile, 
            wonPile, 
            currentTrick: [], 
            leadSuit: null, 
            currentTurn: winnerId, 
            roundStatus: wonPile.length === 52 ? 'ended' : 'playing', 
            updatedAt: serverTimestamp() 
          });
        });
        console.log("🧩 [TRICK_RESOLVE] Transaction committed successfully!");
        // Persist trickId mapping is complete
        resolvingTrickRef.current = trickId;
      } catch (err) { 
        console.error("🧩 [TRICK_RESOLVE] Transaction Error:", err);
        // Reset so system can retry
        resolvingTrickRef.current = null;
      } finally { 
        setSafeProcessing(false); 
        activeTimeoutTrickIdRef.current = null;
        console.log("🧩 [TRICK_RESOLVE] Released transaction block.");
      }
    }, 1300);

    return () => {
      // Clean up timeout if trick actually changes
      const currentGameState = gameStateRef.current;
      if (!currentGameState || currentGameState.currentTrick.length !== 4) {
        if (activeTimeoutRef.current) {
          clearTimeout(activeTimeoutRef.current);
          activeTimeoutRef.current = null;
        }
        activeTimeoutTrickIdRef.current = null;
      }
    };
  }, [gameState, determineTrickWinner, profile, syncProfileToCloud]);

  const watchAd = () => {
    const toastId = toast.loading("WATCHING AD...");
    
    setTimeout(() => {
      const updatedProfile = { ...profile, coins: profile.coins + 500 };
      setProfile(updatedProfile);
      syncProfileToCloud(updatedProfile);
      
      toast.success("500 COINS RECEIVED!", { id: toastId });
    }, 2000);
  };
  useEffect(() => {
    if (!gameState || (view !== 'lobby' && view !== 'searching')) return;
    
    const fetchNames = async () => {
      const names = { ...lobbyPlayerNames };
      const avatars = { ...lobbyPlayerAvatars };
      let changed = false;
      for (const uid of gameState.playerUids) {
        if (!names[uid] || !avatars[uid]) {
          const uSnap = await getDoc(doc(db, 'users', uid));
          if (uSnap.exists()) {
            const userData = uSnap.data();
            names[uid] = userData.username;
            avatars[uid] = userData.avatar || '';
            changed = true;
          }
        }
      }
      if (changed) {
        setLobbyPlayerNames(names);
        setLobbyPlayerAvatars(avatars);
      }
    };
    
    fetchNames();
  }, [gameState?.playerUids, view]);

  // Synchronize visual trick state to allow a gorgeous wipe-away transition on clear
  useEffect(() => {
    if (!gameState) {
      setVisualTrick([]);
      setWipingWinnerId(null);
      setWipingToPile(false);
      return;
    }

    const currentTrick = gameState.currentTrick || [];

    if (currentTrick.length > 0) {
      setVisualTrick(currentTrick);
      setWipingWinnerId(null);
      setWipingToPile(false);
    } else if (currentTrick.length === 0 && visualTrick.length > 0) {
      // Find trick winner based on cards in visualTrick
      const leadSuit = gameState.leadSuit || visualTrick[0]?.card.suit;
      const winnerId = determineTrickWinner(visualTrick, leadSuit, gameState.trumpSuit);

      // If database pile has been cleared, it means someone secured (got) the pile!
      const gotPile = (gameState.pile?.length === 0) && (gameState.wonPile?.length > 0);

      setWipingWinnerId(winnerId);
      setWipingToPile(!gotPile);

      const delayTimer = setTimeout(() => {
        setVisualTrick([]);
        setWipingWinnerId(null);
        setWipingToPile(false);
      }, 750);

      return () => clearTimeout(delayTimer);
    }
  }, [gameState?.currentTrick, gameState?.pile?.length, determineTrickWinner]);

  const [searchingStartTime, setSearchingStartTime] = useState<number | null>(null);
  const [countdown, setCountdown] = useState(10);

  // Heartbeat to keep lobby alive and fresh (Host and clients together)
  useEffect(() => {
    if (view !== 'searching' || !gameState?.id) return;
    
    // Write a regular heartbeat update to Firestore to mark this match as active/fresh
    const interval = setInterval(async () => {
      try {
        const matchRef = doc(db, 'matches', gameState.id);
        await updateDoc(matchRef, {
          updatedAt: serverTimestamp()
        });
        console.log("💓 Match heartbeat updated:", gameState.id);
      } catch (err) {
        console.warn("Heartbeat update failed:", err);
      }
    }, 4500);

    return () => clearInterval(interval);
  }, [view, gameState?.id]);

  useEffect(() => {
    if (view === 'searching' && gameState?.id) {
      if (!searchingStartTime) {
        console.log("✨ Matchmaking queue started! Starting 10s countdown.");
        setSearchingStartTime(Date.now());
      }
    } else {
      setSearchingStartTime(null);
    }
  }, [view, gameState?.id, searchingStartTime]);

  useEffect(() => {
    if (!searchingStartTime || view !== 'searching') {
      setCountdown(10);
      return;
    }
    const interval = setInterval(() => {
      const elapsed = Date.now() - searchingStartTime;
      setCountdown(Math.max(0, Math.ceil((10000 - elapsed) / 1000)));
    }, 500);
    return () => clearInterval(interval);
  }, [searchingStartTime, view]);

  // Auto-start classic matches after timeout (Host only)
  useEffect(() => {
    if (view !== 'searching' || !gameState || gameState.mode !== 'classic' || gameState.roundStatus !== 'lobby' || !searchingStartTime) return;
    if (gameState.playerUids[0] !== auth.currentUser?.uid) return;

    if (countdown <= 0) {
      console.log("🚀 Auto-starting classic match due to timeout...");
      startMatchFromLobby();
    }
  }, [gameState?.playerUids.length, view, gameState?.id, startMatchFromLobby, searchingStartTime, countdown]);

  const renderView = () => {
    if (view === 'searching') {
      const playerCount = gameState?.playerUids.length || 0;
      const isHost = gameState?.playerUids[0] === auth.currentUser?.uid;

      return (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="h-[100dvh] w-full flex flex-col items-center justify-center bg-black p-8 relative overflow-hidden"
        >
          <button 
            onClick={async () => {
              await leaveCurrentMatch();
              setView('home');
            }}
            className="absolute top-6 right-6 w-10 h-10 rounded-full border border-white/10 hover:border-white/30 hover:bg-white/5 flex items-center justify-center transition-all text-sm font-black text-white/45 z-[50]"
            title="Cancel Matchmaking"
          >
            ✕
          </button>

          {/* Subtle static card patterns in background */}
          <div className="absolute inset-0 opacity-[0.03] pointer-events-none select-none overflow-hidden flex flex-wrap gap-12 rotate-12 scale-150">
            {Array.from({ length: 20 }).map((_, i) => (
              <div key={i} className="text-8xl">🃏</div>
            ))}
          </div>

          <div className="relative z-10 flex flex-col items-center">
            <div className="relative mb-12">
              <motion.div 
                animate={{ rotate: 360 }}
                transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
                className="w-32 h-32 rounded-full border-t-2 border-indigo-500 mb-8"
              ></motion.div>
              <div className="absolute inset-0 flex items-center justify-center text-3xl font-black text-indigo-500">
                {playerCount > 0 ? playerCount : '🃏'}
              </div>
            </div>

            <h2 className="text-2xl font-black uppercase tracking-[0.3em] mb-2 text-center">
              {playerCount > 0 ? `ARENA: ${playerCount}/4` : 'MATCHMAKING'}
            </h2>
            
            <p className="text-white/30 text-[10px] uppercase font-bold tracking-[0.2em] text-center max-w-[250px] leading-relaxed">
              {playerCount === 0 
                ? 'Negotiating entry to elite servers...' 
                : 'Awaiting remaining challengers to finalize the table.'}
            </p>
            
            {playerCount >= 1 && gameState?.mode === 'classic' && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-8 flex flex-col items-center gap-3"
              >
                <div className="flex items-center gap-2 px-4 py-2 bg-indigo-500/10 border border-indigo-500/20 rounded-full">
                  <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-pulse" />
                  <span className="text-[9px] font-black uppercase tracking-widest text-indigo-400">
                    {playerCount >= 2 ? 'Stable Match Found' : 'Searching for players'}
                  </span>
                </div>
                
                <div className="text-[10px] font-black text-white/40 uppercase tracking-[0.2em]">
                  Gathering lobby in <span className="text-white">{countdown}s</span>
                </div>
              </motion.div>
            )}

            <div className="mt-16 flex flex-col gap-4 w-full max-w-[280px]">
            {isHost && playerCount >= 1 && (
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => {
                    console.log("👆 Manual Start Triggered by Host");
                    startMatchFromLobby();
                  }}
                  disabled={isProcessing}
                  className="w-full py-4 bg-indigo-600/20 border border-indigo-500/40 rounded-xl text-[10px] font-black uppercase tracking-widest text-indigo-400 hover:bg-indigo-600/30 transition-all disabled:opacity-50"
                >
                  {isProcessing ? 'INITIALIZING...' : countdown <= 0 ? 'FORCE START ARENA' : playerCount === 1 ? 'START WITH AIs' : 'START NOW (AI FILL)'}
                </motion.button>
              )}

              <motion.button 
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={async () => {
                  await leaveCurrentMatch();
                  setView('home');
                }}
                className="w-full py-4 bg-white/5 border border-white/10 rounded-xl text-[10px] font-black uppercase tracking-widest text-white/30 hover:bg-white/10 hover:text-white transition-all underline underline-offset-4 decoration-white/0 hover:decoration-white/10"
              >
                ABANDON SEARCH
              </motion.button>
            </div>
          </div>
        </motion.div>
      );
    }

    if (view === 'lobby') {
      return (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="min-h-[100dvh] w-full flex flex-col items-center justify-center bg-transparent p-4 md:p-8 overflow-y-auto custom-scrollbar"
        >
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="glass-panel p-6 md:p-10 rounded-3xl md:rounded-[2.5rem] border-white/10 w-full max-w-md text-center relative"
          >
            <button 
              onClick={async () => {
                await leaveCurrentMatch();
                setView('home');
              }}
              className="absolute top-6 right-6 w-8 h-8 rounded-full border border-white/10 hover:border-white/30 hover:bg-white/5 flex items-center justify-center transition-all text-xs font-black text-white/45 z-[10]"
              title="Leave / Cancel Table"
            >
              ✕
            </button>

            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-indigo-500 to-transparent animate-shimmer"></div>
            <div className="text-[8px] font-black text-indigo-400 uppercase tracking-[0.3em] mb-2">{gameState?.mode === 'private' ? 'Private Arena' : 'Public Arena'}</div>
            <h2 className="text-3xl font-black mb-8">LOBBY</h2>
            {gameState?.mode === 'private' && (
              <div className="bg-white/5 p-6 rounded-2xl border border-white/10 mb-8">
                <div className="text-[8px] font-black text-white/20 uppercase mb-1">Table Code</div>
                <div className="text-2xl font-mono font-black tracking-widest text-indigo-400 flex items-center justify-center gap-2">
                  {gameState?.tableCode}
                  <button 
                    onClick={() => {
                      navigator.clipboard.writeText(gameState?.tableCode || '');
                      toast.success("Code copied!");
                    }}
                    className="text-xs opacity-50 hover:opacity-100"
                  >
                    📋
                  </button>
                </div>
              </div>
            )}
            <div className="space-y-4">
              {gameState?.playerUids.map((uid, i) => (
                <div key={`lobby-player-${i}`} className="flex items-center justify-between p-4 bg-white/5 rounded-xl border border-white/10">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-[10px] overflow-hidden">
                      {lobbyPlayerAvatars[uid] ? (
                        <img src={lobbyPlayerAvatars[uid]} className="w-full h-full object-cover" alt="Avatar" referrerPolicy="no-referrer" />
                      ) : (
                        lobbyPlayerNames[uid]?.[0]?.toUpperCase() || 'P'
                      )}
                    </div>
                    <span className="font-black uppercase text-xs">
                      {lobbyPlayerNames[uid] || (uid === auth.currentUser?.uid ? profile.username : 'Elite Player')}
                    </span>
                  </div>
                  <span className="text-[8px] font-black text-emerald-400 uppercase bg-emerald-400/10 px-2 py-1 rounded">Connected</span>
                </div>
              ))}
              {Array.from({ length: 4 - (gameState?.playerUids.length || 0) }).map((_, i) => (
                <button 
                  key={`lobby-waiting-${i}`} 
                  onClick={() => setIsFriendsOpen(true)}
                  className="w-full flex items-center justify-between p-4 bg-white/5 hover:bg-white/10 hover:border-indigo-500/30 active:scale-[0.99] rounded-xl border border-white/10 group transition-all text-left"
                  title="Invite friends to this slot"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 group-hover:scale-110 transition-transform font-bold text-sm">
                      ➕
                    </div>
                    <div>
                      <span className="font-black uppercase text-xs text-white/50 group-hover:text-indigo-300 transition-colors">Invite Friend</span>
                      <div className="text-[7px] font-bold text-white/20 uppercase tracking-wider">Empty Slot</div>
                    </div>
                  </div>
                  <span className="text-[6px] font-black text-indigo-400 uppercase bg-indigo-500/10 border border-indigo-500/20 px-2 py-1 rounded">Slot {(gameState?.playerUids.length || 0) + i + 1}</span>
                </button>
              ))}
            </div>
            
            <div className="mt-10 space-y-4">
              {gameState?.playerUids[0] === auth.currentUser?.uid ? (
                <motion.button 
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={startMatchFromLobby} 
                  className="gold-button w-full py-5 rounded-2xl text-lg"
                >
                  Start Match
                </motion.button>
              ) : (
                <div className="py-5 text-[10px] font-black text-white/20 uppercase animate-pulse">
                  Waiting for host to start...
                </div>
              )}
              
              <button 
                onClick={async () => {
                  await leaveCurrentMatch();
                  setView('home');
                }}
                className="w-full py-3 text-[8px] font-black text-white/20 hover:text-red-400 uppercase tracking-widest transition-colors"
              >
                Leave Lobby
              </button>
            </div>
          </motion.div>
        </motion.div>
      );
    }

    if (view === 'login') {
      return (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="h-[100dvh] w-full flex flex-col items-center justify-center p-8 bg-transparent relative overflow-hidden"
        >
          {/* Professional Card Game Background Visuals */}
          <div className="absolute inset-0 pointer-events-none z-0">
            <motion.div 
              animate={{ 
                y: [0, -20, 0],
                rotate: [15, 18, 15]
              }}
              transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
              className="absolute top-[10%] left-[5%] w-[300px] h-[400px] blur-[1px]"
            >
              <CardComponent hidden skin="gold" className="scale-150 opacity-20" />
            </motion.div>
            <motion.div 
              animate={{ 
                y: [0, 20, 0],
                rotate: [-15, -18, -15]
              }}
              transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
              className="absolute bottom-[10%] right-[5%] w-[300px] h-[400px] blur-[1px]"
            >
              <CardComponent hidden skin="void" className="scale-150 opacity-20" />
            </motion.div>
            
            {/* Floating Suits */}
            <div className="absolute inset-0 overflow-hidden opacity-10">
              {Array.from({ length: 12 }).map((_, i) => (
                <motion.div 
                  key={`login-suit-${i}`} 
                  initial={{ 
                    top: `${Math.random() * 100}%`,
                    left: `${Math.random() * 100}%`,
                    opacity: 0
                  }}
                  animate={{ 
                    y: [0, -100, 0],
                    x: [0, 50, 0],
                    opacity: [0, 1, 0],
                    rotate: [0, 360]
                  }}
                  transition={{ 
                    duration: 15 + Math.random() * 10, 
                    repeat: Infinity, 
                    delay: Math.random() * 5,
                    ease: "linear"
                  }}
                  className="absolute text-6xl"
                >
                  {['♠', '♣', '♥', '♦'][i % 4]}
                </motion.div>
              ))}
            </div>
          </div>

          <motion.div 
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="w-full max-w-md z-10 space-y-6 text-center relative"
          >
            <div className="space-y-1">
              <h1 className="text-6xl md:text-8xl turab-title font-black italic tracking-tighter">TURAB'</h1>
              <p className="text-indigo-400 font-black uppercase tracking-[0.4em] text-[8px] opacity-60">Elite Card Series</p>
            </div>
            
            <motion.div 
              whileHover={{ scale: 1.01 }}
              className="glass-panel p-6 md:p-8 rounded-3xl md:rounded-[2.5rem] border-white/10 shadow-[0_20px_50px_rgba(0,0,0,0.5)] relative group"
            >
              <div className="absolute -inset-1 bg-gradient-to-r from-indigo-500/20 to-purple-500/20 rounded-[3rem] blur opacity-0 group-hover:opacity-100 transition duration-1000"></div>
              <div className="relative">
                <h2 className="text-xl font-black uppercase tracking-widest mb-8 text-white/80">
                  {isSignUp ? 'Register for Gaming App' : 'Log In'}
                </h2>
                <div className="space-y-4">
                  {isSignUp && (
                    <input 
                      type="text" 
                      value={signupUsername}
                      onChange={e => setSignupUsername(e.target.value)}
                      placeholder="CHOOSE USERNAME" 
                      className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 text-sm font-black outline-none focus:border-indigo-500/50 focus:bg-white/10 transition-all uppercase placeholder:text-white/20" 
                    />
                  )}
                  <input 
                    type="email" 
                    value={loginEmail}
                    onChange={e => setLoginEmail(e.target.value)}
                    placeholder="EMAIL" 
                    className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 text-sm font-black outline-none focus:border-indigo-500/50 focus:bg-white/10 transition-all uppercase placeholder:text-white/20" 
                  />
                  <input 
                    type="password" 
                    value={loginPass}
                    onChange={e => setLoginPass(e.target.value)}
                    placeholder="PASSWORD" 
                    className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 text-sm font-black outline-none focus:border-indigo-500/50 focus:bg-white/10 transition-all uppercase placeholder:text-white/20" 
                  />
                  <motion.button 
                    whileTap={{ scale: 0.98 }}
                    onClick={() => handleLogin('email')}
                    disabled={!loginEmail || !loginPass || (isSignUp && !signupUsername) || isLoggingIn}
                    className="gold-button w-full py-5 rounded-2xl text-lg mt-2 disabled:opacity-50 shadow-[0_10px_20px_rgba(251,191,36,0.2)]"
                  >
                    {isLoggingIn ? (isSignUp ? 'CREATING...' : 'LOGGING IN...') : (isSignUp ? 'REGISTER' : 'LOG IN')}
                  </motion.button>
                  
                  <div className="pt-4">
                    <button 
                      onClick={() => setIsSignUp(!isSignUp)}
                      className="text-[10px] font-black uppercase text-indigo-400 hover:text-white transition-colors"
                    >
                      {isSignUp ? 'Already have an account? Sign In' : "Don't have an account? Sign Up"}
                    </button>
                  </div>

                  <div className="relative py-4">
                    <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-white/5"></div></div>
                    <div className="relative flex justify-center text-[8px] font-black uppercase"><span className="bg-transparent px-2 text-white/20">OR CONTINUE WITH</span></div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <motion.button whileHover={{ y: -2 }} onClick={() => handleLogin('google')} className="bg-white text-black rounded-2xl py-4 font-black text-[10px] uppercase hover:bg-white/90 transition-colors">Google</motion.button>
                    <motion.button whileHover={{ y: -2 }} onClick={() => handleLogin('facebook')} className="bg-[#1877F2] text-white rounded-2xl py-4 font-black text-[10px] uppercase hover:bg-[#1877F2]/90 transition-colors">Facebook</motion.button>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        </motion.div>
      );
    }

    if (view === 'home') {
      const userRank = getLevelTitle(profile.level);
      return (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="h-[100dvh] w-full flex flex-col items-center justify-between p-8 bg-transparent relative overflow-hidden"
        >
          {/* Professional Card Game Background Visuals */}
          <div className="absolute inset-0 pointer-events-none z-0">
            <motion.div 
              animate={{ 
                y: [0, -30, 0],
                rotate: [30, 35, 30]
              }}
              transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
              className="absolute top-20 left-[-50px] blur-[2px]"
            >
              <CardComponent hidden skin="neon" className="scale-125 opacity-10" />
            </motion.div>
            <motion.div 
              animate={{ 
                y: [0, 30, 0],
                rotate: [-30, -35, -30]
              }}
              transition={{ duration: 15, repeat: Infinity, ease: "easeInOut" }}
              className="absolute bottom-40 right-[-50px] blur-[2px]"
            >
              <CardComponent hidden skin="gold" className="scale-125 opacity-10" />
            </motion.div>
            
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-full flex items-center justify-center opacity-20">
              <div className="w-[1000px] h-[1000px] border border-white/5 rounded-full animate-[spin_120s_linear_infinite]"></div>
              <div className="absolute w-[800px] h-[800px] border border-white/5 rounded-full animate-[spin_80s_linear_infinite_reverse]"></div>
              <div className="absolute w-[600px] h-[600px] border border-indigo-500/5 rounded-full animate-[spin_40s_linear_infinite]"></div>
            </div>
          </div>

          <motion.div 
            initial={{ y: -20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="text-center mt-4 md:mt-6 z-10 relative"
          >
            {isOffline && (
              <div className="mb-4 bg-red-500/20 border border-red-500/30 text-red-500 px-4 py-1.5 rounded-full text-[8px] font-black uppercase tracking-widest inline-flex items-center gap-2 animate-pulse">
                <span className="w-2 h-2 rounded-full bg-red-500"></span> INTERNET DISCONNECTED
              </div>
            )}
            <h1 className="text-5xl md:text-7xl turab-title font-black italic tracking-tighter">TURAB'</h1>
            <p className="text-indigo-400 font-black uppercase tracking-[0.4em] text-[8px] mt-1 opacity-60">Pro Gaming App</p>
          </motion.div>

          <motion.div 
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="w-full max-w-sm space-y-4 z-10"
          >
            <motion.div 
              whileHover={{ scale: 1.02 }}
              className="glass-panel p-5 md:p-6 rounded-3xl border-white/10 flex items-center gap-4 shadow-2xl relative overflow-hidden group"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-indigo-600/5 to-purple-600/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
              <button 
                onClick={() => avatarInputRef.current?.click()}
                className="w-14 h-14 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-2xl shadow-inner relative z-10 overflow-hidden group/avatar cursor-pointer hover:border-indigo-400 active:scale-95 transition-all outline-none"
                title="Click to update avatar picture"
              >
                {profile.avatar ? (
                  <img src={profile.avatar} className="w-full h-full object-cover transition-transform group-hover/avatar:scale-110" alt="avatar" referrerPolicy="no-referrer" />
                ) : (
                  '👤'
                )}
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/avatar:opacity-100 flex items-center justify-center transition-opacity">
                  <Camera size={14} className="text-white" />
                </div>
                <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-indigo-600 border-2 border-[#0a0f1e] flex items-center justify-center text-[8px] font-black z-20">
                  {profile.level}
                </div>
              </button>
              <div className="flex-1 relative z-10 text-left">
                <div className="flex items-center justify-between mb-1">
                  <div className={`text-[7px] font-black uppercase tracking-widest px-2 py-0.5 rounded ${userRank.bg} ${userRank.color} border ${userRank.border} w-fit`}>{userRank.title}</div>
                  <div 
                    onClick={() => {
                      const idToCopy = profile.gamerId || getNumericPlayerId(profile.turab_id);
                      navigator.clipboard.writeText(idToCopy);
                      toast.success("Player ID copied!");
                    }}
                    className="text-[8px] font-mono font-black text-indigo-400 hover:text-indigo-300 transition-colors cursor-pointer flex items-center gap-1 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded-lg"
                    title="Copy Player ID"
                  >
                    ID: {profile.gamerId || getNumericPlayerId(profile.turab_id)} 📋
                  </div>
                </div>
                <div 
                  onClick={() => {
                    setNewUsername(profile.username);
                    setIsRenameModalOpen(true);
                  }}
                  className="flex items-center gap-2 cursor-pointer mt-1 group/rename"
                  title="Click to edit display name"
                >
                  <h2 className="text-xl font-black tracking-tight text-white group-hover/rename:text-indigo-400 transition-colors">
                    {profile.username}
                  </h2>
                  <div className="p-1 rounded bg-white/5 group-hover/rename:bg-indigo-500/20 text-indigo-400 border border-white/5 group-hover/rename:border-indigo-500/40 transition-all flex items-center justify-center">
                    <Pencil size={12} className="stroke-[2.5]" />
                  </div>
                </div>
                <div className="flex items-center gap-3 mt-0.5">
                  <div className="text-sm font-black text-white/90">{profile.role === 'admin' ? '∞' : profile.coins.toLocaleString()} <span className="text-[10px] text-yellow-500">🪙</span></div>
                  <div className="h-0.5 w-20 bg-white/5 rounded-full overflow-hidden">
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: `${(profile.xp % 1000) / 10}%` }}
                      className="h-full bg-indigo-500" 
                    />
                  </div>
                </div>
              </div>
            </motion.div>

            <div className="space-y-4">
              <motion.button 
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => startNewGame('classic')} 
                className="gold-button w-full py-7 rounded-[2rem] text-2xl shadow-[0_15px_30px_rgba(217,119,6,0.3)] transition-all"
              >
                Play Now
              </motion.button>
              
              <div className="grid grid-cols-2 gap-4">
                <motion.button whileHover={{ y: -2 }} onClick={() => startNewGame('private')} className="glass-panel py-5 rounded-2xl text-[10px] font-black uppercase border-indigo-500/30 text-indigo-400 hover:bg-indigo-500/10 transition-all">
                  Create Table
                </motion.button>
                <motion.button whileHover={{ y: -2 }} onClick={() => setIsJoinModalOpen(true)} className="glass-panel py-5 rounded-2xl text-[10px] font-black uppercase border-white/10 hover:bg-white/5 transition-all">
                  Join Table
                </motion.button>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <motion.button whileHover={{ y: -2 }} onClick={() => setIsFriendsOpen(true)} className="glass-panel py-5 rounded-2xl text-[10px] font-black uppercase border-white/10 hover:bg-white/5 transition-all">
                  Friends
                </motion.button>
                <motion.button whileHover={{ y: -2 }} onClick={() => { setTutorialPage(0); setIsTutorialOpen(true); }} className="glass-panel py-5 rounded-2xl text-[10px] font-black uppercase border-white/10 hover:bg-white/5 transition-all text-yellow-500 hover:border-yellow-500/20">
                  How To Play 📖
                </motion.button>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <motion.button whileHover={{ opacity: 1 }} onClick={watchAd} className="py-4 rounded-2xl bg-indigo-600/10 border border-indigo-500/20 text-[10px] font-black uppercase text-indigo-400/60 hover:text-indigo-400 hover:bg-indigo-600/20 transition-all">
                  📺 Free Coins
                </motion.button>
                <motion.button whileHover={{ opacity: 1 }} onClick={handleLogout} className="py-4 rounded-2xl bg-red-600/10 border border-red-500/20 text-[10px] font-black uppercase text-red-400/60 hover:text-red-400 hover:bg-red-600/20 transition-all">
                  📤 Logout
                </motion.button>
              </div>
            </div>
          </motion.div>

          {/* Change Display Name Modal */}
          <AnimatePresence>
            {isRenameModalOpen && (() => {
              const cooldownInfo = getUsernameCooldownInfo();
              const isCooldownActive = !cooldownInfo.canChange && profile.role !== 'admin';
              
              return (
                <motion.div 
                  id="rename-modal-overlay"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 flex items-center justify-center z-[300] p-4"
                >
                  <motion.div 
                    id="rename-modal-bg-dim"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={() => { if (!isProcessing) setIsRenameModalOpen(false); }}
                    className="absolute inset-0 bg-black/80 backdrop-blur-md"
                  />
                  <motion.div 
                    id="rename-modal-content"
                    initial={{ scale: 0.9, opacity: 0, y: 20 }}
                    animate={{ scale: 1, opacity: 1, y: 0 }}
                    exit={{ scale: 0.9, opacity: 0, y: 20 }}
                    className="relative w-full max-w-sm glass-panel p-8 rounded-[2.5rem] border-white/20 shadow-2xl z-[301] text-center mx-auto"
                  >
                    <button 
                      onClick={() => setIsRenameModalOpen(false)}
                      disabled={isProcessing}
                      className="absolute top-6 right-6 w-8 h-8 rounded-full border border-white/10 hover:border-white/30 hover:bg-white/5 flex items-center justify-center transition-all text-xs font-black text-white/45 z-10"
                      title="Close"
                    >
                      ✕
                    </button>
                    <h2 id="rename-modal-title" className="text-2xl font-black uppercase tracking-widest mb-1 text-indigo-400">Display Name</h2>
                    <p id="rename-modal-subtitle" className="text-[10px] font-black text-white/20 uppercase mb-6">
                      Update your multiplayer handle
                    </p>
                    
                    {isCooldownActive ? (
                      <div id="rename-cooldown-active" className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 text-left mb-6 space-y-1.5">
                        <div className="text-[9px] font-black text-amber-500 uppercase tracking-widest">cooldown active ⏳</div>
                        <div className="text-xs font-black text-white/80">You can change your display name once every 60 days.</div>
                        <div className="text-[10px] font-bold text-white/50 pt-2 border-t border-white/5 flex justify-between">
                          <span>Days Remaining:</span>
                          <span className="text-amber-400">{cooldownInfo.daysLeft} days</span>
                        </div>
                        <div className="text-[10px] font-bold text-white/50 flex justify-between">
                          <span>Next Change:</span>
                          <span className="text-amber-400">{cooldownInfo.nextAvailableDate}</span>
                        </div>
                      </div>
                    ) : (
                      <div id="rename-cooldown-info" className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-4 text-[9px] font-black text-emerald-400 text-left mb-6 uppercase tracking-widest text-center">
                        ✓ Available to change now (Once in 60 days)
                      </div>
                    )}

                    <div className="space-y-4 text-left">
                      <label id="rename-input-label" className="text-[8px] font-black text-white/40 uppercase tracking-widest">
                        New Display Name
                      </label>
                      <input 
                        id="rename-input-field"
                        type="text" 
                        maxLength={16}
                        disabled={isCooldownActive || isProcessing}
                        value={newUsername}
                        onChange={(e) => setNewUsername(e.target.value)}
                        placeholder="ElitePlayer"
                        className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-4 text-lg font-bold text-center outline-none focus:border-indigo-500/50 focus:bg-white/10 transition-all text-white placeholder:text-white/10 disabled:opacity-50"
                      />
                      <div className="text-[8px] font-bold text-white/30 uppercase text-center mt-1">
                        Only letters, numbers, spaces, hyphens, and underscores allowed
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4 mt-8">
                      <button 
                        id="rename-cancel-btn"
                        onClick={() => setIsRenameModalOpen(false)}
                        disabled={isProcessing}
                        className="py-4 rounded-2xl bg-white/5 text-[10px] font-black uppercase text-white/40 hover:bg-white/10 transition-all disabled:opacity-50"
                      >
                        Cancel
                      </button>
                      <button 
                        id="rename-save-btn"
                        onClick={handleSaveUsername}
                        disabled={isCooldownActive || isProcessing || !newUsername.trim() || newUsername.trim() === profile.username}
                        className="gold-button py-4 rounded-2xl text-[10px] font-black uppercase disabled:opacity-50"
                      >
                        {isProcessing ? 'Saving...' : 'Save Name'}
                      </button>
                    </div>
                  </motion.div>
                </motion.div>
              );
            })()}
          </AnimatePresence>

          {/* Table / Team Up Invitations Popup Banner */}
          <AnimatePresence>
            {incomingInvites.length > 0 && (
              <motion.div 
                initial={{ y: -100, opacity: 0, x: "-50%" }}
                animate={{ y: 0, opacity: 1, x: "-50%" }}
                exit={{ y: -100, opacity: 0, x: "-50%" }}
                className="fixed top-6 left-1/2 -translate-x-1/2 w-full max-w-md z-[5000] px-4 pointer-events-auto"
              >
                <div className="glass-panel p-4 rounded-[2rem] border-2 border-indigo-500/50 shadow-[0_20px_50px_rgba(0,0,0,0.85)] bg-black/95 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-xl shrink-0 animate-pulse">
                      📡
                    </div>
                    <div className="text-left">
                      <div className="text-[7px] font-black text-indigo-400 uppercase tracking-widest leading-none mb-1">
                        {incomingInvites[0].inviteType === 'teamup' ? 'Team Up Invitation' : 'Arena Invitation'}
                      </div>
                      <div className="text-[11px] font-bold text-white uppercase leading-tight">
                        <span className="text-indigo-400 font-extrabold">{incomingInvites[0].fromUsername}</span>
                        {incomingInvites[0].inviteType === 'teamup' ? ' wants to team up!' : ' invited you to play!'}
                      </div>
                      <div className="text-[8px] font-mono font-black text-white/40 uppercase mt-0.5">
                        Code: {incomingInvites[0].tableCode}
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex gap-2 shrink-0">
                    <button 
                      onClick={() => rejectInvitation(incomingInvites[0].id)}
                      className="px-3 py-2 rounded-xl bg-white/5 border border-white/5 hover:bg-white/10 text-[8px] uppercase font-black text-white/50 tracking-wider transition-all"
                    >
                      Decline
                    </button>
                    <button 
                      onClick={() => acceptInvitation(incomingInvites[0])}
                      className="gold-button px-4 py-2 rounded-xl text-[8px] font-black uppercase tracking-wider"
                    >
                      Accept
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Join Table Modal */}
          <AnimatePresence>
            {isJoinModalOpen && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 flex items-center justify-center z-[300] p-4"
              >
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={() => setIsJoinModalOpen(false)}
                    className="absolute inset-0 bg-black/80 backdrop-blur-md"
                  />
                  <motion.div 
                    initial={{ scale: 0.9, opacity: 0, y: 20 }}
                    animate={{ scale: 1, opacity: 1, y: 0 }}
                    exit={{ scale: 0.9, opacity: 0, y: 20 }}
                    className="relative w-full max-w-sm glass-panel p-8 rounded-[2.5rem] border-white/20 shadow-2xl z-[301] text-center mx-auto"
                  >
                    <button 
                      onClick={() => setIsJoinModalOpen(false)}
                      className="absolute top-6 right-6 w-8 h-8 rounded-full border border-white/10 hover:border-white/30 hover:bg-white/5 flex items-center justify-center transition-all text-xs font-black text-white/45 z-10"
                      title="Close"
                    >
                      ✕
                    </button>
                    <h2 className="text-2xl font-black uppercase tracking-widest mb-2 text-indigo-400">Join Table</h2>
                  <p className="text-[10px] font-black text-white/20 uppercase mb-8">Enter the secret table code</p>
                  
                  <input 
                    type="text" 
                    inputMode="numeric"
                    maxLength={6}
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value.replace(/[^0-9]/g, ''))}
                    placeholder="123456"
                    className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-5 text-3xl font-mono font-black text-center outline-none focus:border-indigo-500/50 focus:bg-white/10 transition-all tracking-[0.3em] placeholder:text-white/10"
                  />
                  
                  <div className="grid grid-cols-2 gap-4 mt-8">
                    <button 
                      onClick={() => setIsJoinModalOpen(false)}
                      className="py-4 rounded-2xl bg-white/5 text-[10px] font-black uppercase text-white/40 hover:bg-white/10"
                    >
                      Cancel
                    </button>
                    <button 
                      onClick={() => joinPrivateTable(joinCode)}
                      disabled={!joinCode || isProcessing}
                      className="gold-button py-4 rounded-2xl text-[10px]"
                    >
                      {isProcessing ? 'Connecting...' : 'Join Now'}
                    </button>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* How to Play Tutorial Modal */}
          <AnimatePresence>
            {isTutorialOpen && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 flex items-center justify-center z-[300] p-4"
              >
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setIsTutorialOpen(false)}
                  className="absolute inset-0 bg-black/85 backdrop-blur-md"
                />
                <motion.div 
                  initial={{ scale: 0.9, opacity: 0, y: 20 }}
                  animate={{ scale: 1, opacity: 1, y: 0 }}
                  exit={{ scale: 0.9, opacity: 0, y: 20 }}
                  className="relative w-full max-w-md glass-panel p-8 rounded-[2.5rem] border-white/20 shadow-2xl z-[301] text-left mx-auto flex flex-col"
                >
                  <button 
                    onClick={() => setIsTutorialOpen(false)}
                    className="absolute top-6 right-6 w-8 h-8 rounded-full border border-white/10 hover:border-white/30 hover:bg-white/5 flex items-center justify-center transition-all text-xs font-black text-white/45"
                  >
                    ✕
                  </button>

                  <div className="flex items-center gap-4 mb-4">
                    <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-2xl">
                      {TUTORIAL_PAGES[tutorialPage].icon}
                    </div>
                    <div>
                      <h2 className="text-xl font-black uppercase tracking-tight text-indigo-400">{TUTORIAL_PAGES[tutorialPage].title}</h2>
                      <p className="text-[10px] font-black text-white/30 uppercase">{TUTORIAL_PAGES[tutorialPage].subtitle}</p>
                    </div>
                  </div>

                  {/* Divider */}
                  <div className="h-px bg-white/5 my-4" />

                  {/* Body Text */}
                  <div className="text-[12px] font-semibold text-white/70 leading-relaxed whitespace-pre-wrap min-h-[140px]">
                    {TUTORIAL_PAGES[tutorialPage].content}
                  </div>

                  {/* Progress Indicator */}
                  <div className="flex justify-center gap-1.5 my-6">
                    {TUTORIAL_PAGES.map((_, i) => (
                      <button 
                        key={`tutorial-dot-${i}`} 
                        onClick={() => setTutorialPage(i)}
                        className={`h-1 rounded-full transition-all duration-300 ${i === tutorialPage ? 'w-6 bg-indigo-500' : 'w-2 bg-white/10 hover:bg-white/20'}`}
                      />
                    ))}
                  </div>

                  {/* Modal Footer Controls */}
                  <div className="grid grid-cols-2 gap-4 mt-2">
                    <button 
                      onClick={() => setTutorialPage(prev => Math.max(0, prev - 1))}
                      disabled={tutorialPage === 0}
                      className="py-4 rounded-2xl bg-white/5 border border-white/10 text-[10px] font-black uppercase text-white/60 hover:bg-white/10 disabled:opacity-30 transition-all"
                    >
                      Back
                    </button>
                    {tutorialPage < TUTORIAL_PAGES.length - 1 ? (
                      <button 
                        onClick={() => setTutorialPage(prev => Math.min(TUTORIAL_PAGES.length - 1, prev + 1))}
                        className="gold-button py-4 rounded-2xl text-[10px]"
                      >
                        Next
                      </button>
                    ) : (
                      <button 
                        onClick={() => setIsTutorialOpen(false)}
                        className="gold-button py-4 rounded-2xl text-[10px]"
                      >
                        Got It!
                      </button>
                    )}
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      );
    }

    if (!gameState) {
      return (
        <div className="h-full w-full flex flex-col items-center justify-center bg-transparent p-8">
          <div className="w-16 h-16 rounded-full border-t-2 border-indigo-500 animate-spin mb-4 relative z-10"></div>
          <p className="text-white/40 text-[10px] uppercase font-black relative z-10">Initializing Arena...</p>
        </div>
      );
    }

    return (
      <div className="h-[100dvh] w-full relative bg-transparent flex flex-col items-center justify-center overflow-hidden">
        {/* Professional Card Game Background Visuals - Game View */}
        <div className="absolute inset-0 pointer-events-none opacity-20 z-0">
          <div className="absolute top-[-10%] left-[-10%] w-[30%] h-[30%] rotate-45 blur-xl">
            <div className="w-full h-full bg-indigo-500/20 rounded-full"></div>
          </div>
          <div className="absolute bottom-[-10%] right-[-10%] w-[30%] h-[30%] -rotate-45 blur-xl">
            <div className="w-full h-full bg-purple-500/20 rounded-full"></div>
          </div>
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-full opacity-5">
            <div className="grid grid-cols-10 gap-12 rotate-12 scale-150">
              {Array.from({ length: 100 }).map((_, i) => (
                <div key={`game-bg-suit-${i}`} className="text-2xl text-white/10 font-black select-none">
                  {['♠', '♣', '♥', '♦'][i % 4]}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Sleek central space remains clean and premium */}

        <div className="absolute top-0 left-0 p-4 md:p-6 z-[150] flex flex-col gap-3 items-start">
          <div className="flex gap-2">
            <button onClick={() => setIsExitConfirmOpen(true)} className="glass-panel w-10 h-10 rounded-full flex items-center justify-center">←</button>
            <div className="glass-panel p-2 px-5 rounded-xl border-white/10">
              <div className="text-[8px] font-black text-indigo-400 uppercase">TEAM ALPHA</div>
              <div className="text-xl font-black">{teamAlphaScore}</div>
            </div>
          </div>
        </div>

        <div className="absolute top-0 right-0 p-4 md:p-6 z-[150] flex gap-2">
          {gameState.trumpSuit && (
            <div className="glass-panel p-2 px-4 rounded-xl border-indigo-500/30 flex items-center gap-2">
              <span className="text-indigo-400 text-lg">{suitIcons[gameState.trumpSuit]}</span>
              <span className="text-[8px] font-black uppercase text-white/60">TRUMP</span>
            </div>
          )}
          <button onClick={toggleMic} className={`glass-panel w-10 h-10 rounded-full flex items-center justify-center transition-all ${isMicActive ? 'mic-active' : 'text-white/50'}`}>
            {isMicActive ? '🎤' : '🎙️'}
          </button>
          <button 
            onClick={() => {
              if (isPeerVoiceActive) {
                cleanupPeerVoice();
              } else {
                initPeerVoice();
                if (gameState?.playerUids) callPlayers(gameState.playerUids);
              }
            }} 
            className={`glass-panel w-10 h-10 rounded-full flex items-center justify-center transition-all ${isPeerVoiceActive ? 'bg-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.5)]' : 'text-white/50'}`}
          >
            {isPeerVoiceActive ? '🔊' : '🔈'}
          </button>
        </div>

        <div className={`felt-table mt-[-100px] w-[350px] h-[350px] md:w-[650px] md:h-[650px] rounded-full flex items-center justify-center relative z-10 ${isThunderActive ? 'thunder-active' : ''}`}>
          {/* Trump Indicator - Eye Catching */}
          {gameState.trumpSuit && (
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none select-none z-0">
              <div className="relative">
                <div className="absolute inset-0 blur-[60px] md:blur-[100px] opacity-30 animate-pulse" style={{ color: isRedSuit(gameState.trumpSuit) ? '#ef4444' : '#6366f1' }}>
                  {suitIcons[gameState.trumpSuit]}
                </div>
                <div className="text-[140px] md:text-[240px] font-black leading-none opacity-[0.07] transform hover:scale-110 transition-transform duration-1000">
                  {suitIcons[gameState.trumpSuit]}
                </div>
              </div>
            </div>
          )}

          {/* Player Seats & Opponent Fans */}
          {gameState.players.map((p) => {
            const visualSeatIdx = (p.id - myPlayerId + 4) % 4;

            const positions = [
              "bottom-[-40px] left-1/2 -translate-x-1/2", // South (Player)
              "left-[-40px] top-1/2 -translate-y-1/2", // West
              "top-[-40px] left-1/2 -translate-x-1/2", // North
              "right-[-40px] top-1/2 -translate-y-1/2"  // East
            ];
            
            const fanPositions = [
              "", // South (Handled separately)
              "left-[40px] md:left-[80px] top-1/2 -translate-y-1/2 rotate-90", // West
              "top-[40px] md:top-[80px] left-1/2 -translate-x-1/2 rotate-180", // North
              "right-[40px] md:right-[80px] top-1/2 -translate-y-1/2 -rotate-90"  // East
            ];

            const isCurrentTurn = gameState.currentTurn === p.id;
            
            return (
              <React.Fragment key={`seat-${p.id}`}>
                {/* Opponent Card Fan */}
                {p.id !== myPlayerId && (
                  <div className={`absolute ${fanPositions[visualSeatIdx]} pointer-events-none z-20`}>
                    <div className="relative flex items-center justify-center">
                      {p.hand.slice(0, 6).map((_, idx) => { // Show max 6 for cleaner look
                        const total = Math.min(p.hand.length, 6);
                        const angleStep = 12;
                        const startAngle = -((total - 1) * angleStep) / 2;
                        const angle = startAngle + idx * angleStep;
                        return (
                          <div 
                            key={`opp-hand-${p.id}-${idx}`}
                            className="absolute origin-bottom"
                            style={{
                              transform: `rotate(${angle}deg) translateY(-30px)`,
                              zIndex: idx
                            }}
                          >
                            <CardComponent hidden skin={profile.activeSkin} className="scale-[0.35] md:scale-[0.45] opacity-100 shadow-xl border-white/20" />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                 {/* Seat Info */}
                <div className={`absolute ${positions[visualSeatIdx]} z-[100] flex flex-col items-center`}>
                  <div className="relative">
                    {p.activeChat && (
                      <motion.div 
                        initial={{ scale: 0, opacity: 0, y: 15 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        className="absolute bottom-16 left-1/2 -translate-x-1/2 z-[500] bg-indigo-950/95 border border-indigo-400/40 text-[9px] font-black uppercase text-white px-3 py-1.5 rounded-2xl shadow-[0_4px_20px_rgba(99,102,241,0.4)] whitespace-nowrap flex items-center gap-1.5 bg-gradient-to-tb from-indigo-950 to-[#0e143c]"
                      >
                        <div className="absolute bottom-[-5px] left-1/2 -translate-x-1/2 w-2 h-2 bg-[#0e143c] border-r border-b border-indigo-400/40 transform rotate-45" />
                        <span className="text-[11px]">💬</span> {p.activeChat}
                      </motion.div>
                    )}

                    {p.activeSignal && (
                      <div className={`absolute -top-10 left-1/2 -translate-x-1/2 w-6 h-6 rounded-full flex items-center justify-center text-[10px] shadow-lg animate-bounce border z-[140] ${
                        p.activeSignal === 'trump_ace'
                          ? 'bg-yellow-500/20 border-yellow-400 text-yellow-300 shadow-yellow-500/30'
                          : 'bg-sky-500/20 border-sky-400 text-sky-300 shadow-sky-500/30'
                      }`}>
                        {p.activeSignal === 'trump_ace' ? '⭐' : '🛡️'}
                      </div>
                    )}

                    <div className={`w-12 h-12 rounded-full glass-panel flex items-center justify-center text-xl border-2 transition-all duration-300 overflow-hidden ${
                      p.activeSignal === 'trump_ace'
                        ? 'border-yellow-400 scale-110 shadow-[0_0_25px_#fbbf24] bg-yellow-950/40'
                        : p.activeSignal === 'double_guard'
                          ? 'border-sky-400 scale-110 shadow-[0_0_25px_#38bdf8] bg-sky-950/40'
                          : isCurrentTurn 
                            ? 'border-indigo-400 scale-110 shadow-[0_0_20px_rgba(129,140,248,0.4)] bg-indigo-950/40' 
                            : 'border-white/10'
                    }`}>
                      {p.isAI ? (
                        '🤖'
                      ) : p.avatar || (p.uid && lobbyPlayerAvatars[p.uid]) ? (
                        <img 
                          src={p.avatar || (p.uid ? lobbyPlayerAvatars[p.uid] : undefined)} 
                          className="w-full h-full object-cover" 
                          alt="avatar" 
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        '👤'
                      )}
                    </div>
                    {isCurrentTurn && (
                      <>
                        <svg className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-14 h-14 pointer-events-none -rotate-90 z-[120]">
                          {/* Outer thin dark track */}
                          <circle
                            cx="28"
                            cy="28"
                            r="25"
                            fill="transparent"
                            stroke="rgba(255, 255, 255, 0.05)"
                            strokeWidth="2.5"
                          />
                          {/* Actively reducing glowing timer path */}
                          <circle
                            cx="28"
                            cy="28"
                            r="25"
                            fill="transparent"
                            stroke={
                              turnTimeLeft <= 5 
                                ? "rgba(244, 63, 94, 0.9)" 
                                : p.id === myPlayerId 
                                  ? "rgba(52, 211, 153, 0.9)" 
                                  : "rgba(129, 140, 248, 0.9)"
                            }
                            strokeWidth="2.5"
                            strokeDasharray="157.08"
                            strokeDashoffset={157.08 - (157.08 * turnTimeLeft) / 15}
                            strokeLinecap="round"
                            className="transition-all duration-1000 ease-linear"
                            style={{
                              filter: turnTimeLeft <= 5 
                                ? "drop-shadow(0 0 4px rgba(244, 63, 94, 0.6))" 
                                : p.id === myPlayerId 
                                  ? "drop-shadow(0 0 4px rgba(52, 211, 153, 0.6))" 
                                  : "drop-shadow(0 0 4px rgba(129, 140, 248, 0.6))"
                            }}
                          />
                        </svg>
                        <div className="absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center z-[130]">
                          <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                            turnTimeLeft <= 5 ? 'bg-rose-400' : p.id === myPlayerId ? 'bg-emerald-400' : 'bg-indigo-400'
                          }`}></span>
                          <span className={`relative inline-flex rounded-full h-2 w-2 ${
                            turnTimeLeft <= 5 ? 'bg-rose-500' : p.id === myPlayerId ? 'bg-emerald-500' : 'bg-indigo-500'
                          }`}></span>
                        </div>
                      </>
                    )}
                  </div>
                  <div className={`text-[8px] font-black uppercase mt-1 bg-black/60 px-2 py-0.5 rounded border transition-all duration-300 ${
                    isCurrentTurn 
                      ? 'border-indigo-500/40 text-indigo-300 shadow-[0_0_10px_rgba(129,140,248,0.2)]' 
                      : 'border-white/5 text-white/50'
                  }`}>{p.name}</div>
                  <div className={`text-[10px] font-black transition-all ${isCurrentTurn ? 'text-indigo-300' : 'text-indigo-400/60'}`}>{p.score}</div>
                </div>
              </React.Fragment>
            );
          })}

          {/* Mid Pile - Won Stack (Moved to side) */}
          <div className="absolute top-1/2 left-1/2 -translate-x-[140px] md:-translate-x-[220px] -translate-y-1/2 pointer-events-none">
            <div className="relative">
              {gameState.pile.slice(-3).map((card, idx) => (
                <div 
                  key={`pile-card-${idx}`}
                  className="absolute"
                  style={{
                    transform: `translate(${idx * 2}px, ${idx * -1}px) rotate(${idx * 5}deg)`,
                    zIndex: idx
                  }}
                >
                  <CardComponent hidden skin={profile.activeSkin} className="scale-[0.25] md:scale-[0.35] shadow-xl opacity-40" />
                </div>
              ))}
              {gameState.pile.length > 0 && (
                <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 bg-indigo-600/40 px-2 py-0.5 rounded-full border border-indigo-400/20 text-[7px] font-black whitespace-nowrap">
                  {gameState.pile.length} IN PILE
                </div>
              )}
            </div>
          </div>

          <div className="relative w-full h-full flex items-center justify-center pointer-events-none">
            {visualTrick.map((t, idx) => {
              const offsets = [
                "translate-y-[70px] md:translate-y-[120px]", // South
                "-translate-x-[70px] md:-translate-x-[120px]", // West
                "-translate-y-[70px] md:-translate-y-[120px]", // North
                "translate-x-[70px] md:translate-x-[120px]"  // East
              ];
              const isWinning = currentTrickWinnerId === t.playerId;
              const isTrump = gameState.trumpSuit === t.card.suit;
              
              const visualIdx = (t.playerId - myPlayerId + 4) % 4;
              const playedByPlayer = gameState.players[t.playerId];
              const isAI = playedByPlayer?.isAI ?? true;

              const hasSignal = t.signal;
              const dealAnimationClass = hasSignal === 'slow' 
                ? 'animate-slow-play' 
                : hasSignal === 'spin' 
                  ? 'animate-spin-play' 
                  : hasSignal === 'slam' 
                    ? 'animate-slam-play' 
                    : 'animate-deal';

              // Build smooth physical sliding/shrink animation style when trick is complete/wiping
              let styleObj: React.CSSProperties = { transition: 'all 750ms cubic-bezier(0.19, 1, 0.22, 1)' };
              let wrapperClass = `absolute z-[50] ${offsets[visualIdx]}`;
              
              if (wipingWinnerId !== null) {
                wrapperClass = `absolute z-[50]`;
                if (wipingToPile) {
                  styleObj.transform = 'translate(-160px, 0) scale(0.15) rotate(-20deg)';
                } else {
                  const winnerVisualIdx = (wipingWinnerId - myPlayerId + 4) % 4;
                  const targetOffsets = [
                    "translate(0, 260px) scale(0.1) rotate(10deg)",   // South
                    "translate(-260px, 0) scale(0.1) rotate(-10deg)", // West
                    "translate(0, -260px) scale(0.1) rotate(10deg)",  // North
                    "translate(260px, 0) scale(0.1) rotate(-10deg)"  // East
                  ];
                  styleObj.transform = targetOffsets[winnerVisualIdx];
                }
                styleObj.opacity = 0;
              }

              return (
                <div 
                  key={`trick-card-${t.playerId}-${t.card.suit}-${t.card.rank}-${idx}`} 
                  className={wrapperClass}
                  style={styleObj}
                >
                  <div className={`${dealAnimationClass} ${isTrump ? 'animate-trump-play' : ''}`}>
                    <div className="relative">
                      {/* Slam shockwave pulse overlay */}
                      {hasSignal === 'slam' && (
                        <div className="absolute inset-0 z-0 pointer-events-none">
                          <div className="slam-shockwave" />
                        </div>
                      )}
                      
                      {/* Small badge to describe signal under card */}
                      {hasSignal && (
                        <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 bg-black/80 px-2 rounded-full text-[6.5px] font-black text-indigo-400 border border-indigo-500/20 shadow-lg tracking-wider whitespace-nowrap uppercase z-[70] flex items-center gap-0.5">
                          {hasSignal === 'slow' ? '🐢 Slow Hand' : hasSignal === 'spin' ? '🌀 Spin' : '💥 Slam!'}
                        </div>
                      )}

                      <CardComponent 
                        card={t.card} 
                        skin={profile.activeSkin} 
                        className={`scale-75 md:scale-100 shadow-2xl transition-all duration-300 ${isWinning ? 'winner-highlight' : ''} ${isTrump ? 'shadow-[0_0_30px_rgba(99,102,241,0.8)]' : ''}`} 
                      />
                      <div className={`absolute -top-4 -right-4 w-10 h-10 rounded-full glass-panel border-2 flex items-center justify-center text-lg shadow-2xl z-[60] overflow-hidden ${isWinning ? 'border-yellow-400 bg-yellow-400/20' : 'border-white/30 bg-indigo-900/80'}`}>
                        {isAI ? (
                          '🤖'
                        ) : playedByPlayer?.avatar || (playedByPlayer?.uid && lobbyPlayerAvatars[playedByPlayer.uid]) ? (
                          <img 
                            src={playedByPlayer?.avatar || (playedByPlayer?.uid ? lobbyPlayerAvatars[playedByPlayer.uid] : undefined)} 
                            className="w-full h-full object-cover" 
                            alt="avatar" 
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          '👤'
                        )}
                      </div>
                      {isWinning && wipingWinnerId === null && (
                        <div className={`absolute left-1/2 -translate-x-1/2 bg-yellow-400 text-black text-[10px] font-black px-3 py-1 rounded-full uppercase whitespace-nowrap shadow-[0_0_15px_rgba(251,191,36,0.5)] border border-black/20 animate-pulse ${hasSignal ? '-bottom-14' : '-bottom-8'}`}>
                          Winning
                        </div>
                      )}
                      {isTrump && wipingWinnerId === null && (
                        <div className="absolute -top-8 left-1/2 -translate-x-1/2 text-indigo-400 text-[10px] font-black uppercase tracking-widest animate-bounce">
                          Trump!
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Compact, floating, sleek Your Turn overlay indicator right above player cards */}
        {gameState.currentTurn === myPlayerId && gameState.roundStatus === 'playing' && gameState.currentTrick.length < 4 && (
          <div className="absolute bottom-[230px] md:bottom-[280px] left-1/2 -translate-x-1/2 z-[400] pointer-events-none select-none">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              className="flex items-center gap-1.5 px-3.5 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-full shadow-[0_4px_15px_rgba(52,211,153,0.15)] backdrop-blur-md"
            >
              <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-ping" />
              <span className="text-[9px] font-black uppercase tracking-[0.2em] text-emerald-400">Your Turn</span>
            </motion.div>
          </div>
        )}

        <div 
          className="card-wing-container w-full max-w-[100vw]"
          onTouchMove={(e) => {
            // Prevent scrolling on touch devices during active card choosing or dragging
            if (e.cancelable) {
              e.preventDefault();
            }
            const touch = e.touches[0];
            const elem = document.elementFromPoint(touch.clientX, touch.clientY);
            const cardElem = elem?.closest('.wing-card');
            if (cardElem) {
              const key = cardElem.getAttribute('data-card-key');
              if (key) setHoveredCardKey(key);
            } else {
              setHoveredCardKey(null);
            }
          }}
          onTouchEnd={() => {
            if (hoveredCardKey) {
              const part = hoveredCardKey.split('-');
              const idxStr = part[part.length - 1];
              const idx = parseInt(idxStr, 10);
              const card = playerHandSorted[idx];
              if (card) {
                const isSelectable = isMyTurn && (!gameState.leadSuit || card.suit === gameState.leadSuit || !gameState.players[myPlayerId]?.hand.some(c => c.suit === gameState.leadSuit));
                if (isSelectable) {
                  playCard(myPlayerId, card);
                }
              }
            }
            setHoveredCardKey(null);
          }}
        >
          {(() => {
            const total = playerHandSorted.length;
            const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
            
            const hoveredCardObj = hoveredCardKey ? playerHandSorted.find((_, i) => `${playerHandSorted[i].suit}-${playerHandSorted[i].rank}-${i}` === hoveredCardKey) : null;
            const poppedSuit = hoveredCardObj ? hoveredCardObj.suit : (isMyTurn && gameState.leadSuit ? gameState.leadSuit : null);

            // Calculations for wide layout on popped / active selector fanning
            // Highly ergonomic dynamic scaling: spread widens smoothly as fewer cards remain
            const countFactor = Math.max(1, 13 / Math.max(1, total));
            const dynamicScale = 1 + (countFactor - 1) * 0.35; // Ergonometric spacing curve
            
            const maxSpan = (isMobile ? 28 : 45) * dynamicScale;
            const normalAngleStep = Math.min((isMobile ? 2.5 : 3.5) * dynamicScale, maxSpan / Math.max(total, 1)); 
            
            // Generate standard vs expanded steps for the hand
            const expandedAngleStep = normalAngleStep * (isMobile ? 2.4 : 3.2); // SPREAD WIDER for the popped suit card selection
            const gapAngle = (isMobile ? 3.0 : 4.5) * dynamicScale; // Visual separator to make the active suit popup isolated and extremely easy to select!
            
            const cardSteps: number[] = [];
            for (let i = 0; i < total; i++) {
              if (i === 0) {
                cardSteps.push(0);
              } else {
                const prevCard = playerHandSorted[i - 1];
                const currCard = playerHandSorted[i];
                
                const prevIsPopped = poppedSuit && prevCard.suit === poppedSuit;
                const currIsPopped = poppedSuit && currCard.suit === poppedSuit;
                
                let step = normalAngleStep;
                if (prevIsPopped && currIsPopped) {
                  step = expandedAngleStep;
                } else if (prevIsPopped !== currIsPopped) {
                  step = normalAngleStep + gapAngle;
                }
                cardSteps.push(step);
              }
            }
            
            const totalAngleSpan = cardSteps.reduce((sum, step) => sum + step, 0);
            const startAngle = -totalAngleSpan / 2;
            
            let runningAngle = startAngle;
            return playerHandSorted.map((card, idx) => {
              const cardKey = `${card.suit}-${card.rank}-${idx}`;
              const isSelectable = isMyTurn && (!gameState.leadSuit || card.suit === gameState.leadSuit || !gameState.players[myPlayerId]?.hand.some(c => c.suit === gameState.leadSuit));
              
              runningAngle += cardSteps[idx];
              const angle = runningAngle;
              
              const radius = isMobile ? 500 : 800; 
              const x = radius * Math.sin((angle * Math.PI) / 180);
              const y = radius - radius * Math.cos((angle * Math.PI) / 180);
              
              const isTrump = gameState.trumpSuit === card.suit;
              const isCardHovered = hoveredCardKey === cardKey;
              const isSuitHovered = hoveredCardObj && card.suit === hoveredCardObj.suit;
              const isLeadSuitPop = isMyTurn && gameState.leadSuit && card.suit === gameState.leadSuit;
              
              let popupOffset = 0;
              if (isCardHovered) {
                popupOffset = isMobile ? -50 : -75; // Extra pop for the specific card
              } else if (isSuitHovered || isLeadSuitPop) {
                popupOffset = isMobile ? -30 : -45; // Normal pop for the suit/lead group
              }

              const handleCardPlay = (e?: React.MouseEvent) => {
                if (e) {
                  e.preventDefault();
                  e.stopPropagation();
                }
                setHoveredCardKey(null);
                playCard(myPlayerId, card);
              };

              return (
                <div 
                  key={cardKey} 
                  className="wing-card"
                  data-card-key={cardKey}
                  onMouseEnter={() => { if (!isTouchDevice) setHoveredCardKey(cardKey); }}
                  onMouseLeave={() => { if (!isTouchDevice) setHoveredCardKey(null); }}
                  onTouchStart={() => { if (isTouchDevice) setHoveredCardKey(cardKey); }}
                  style={{
                    transform: `translate(${x}px, ${y + popupOffset}px) rotate(${angle}deg)`,
                    zIndex: isCardHovered ? 3000 : ((isSuitHovered || isLeadSuitPop) ? 2000 : idx)
                  }}
                >
                  <CardComponent 
                    card={card} 
                    skin={profile.activeSkin} 
                    onClick={!isTouchDevice ? handleCardPlay : undefined}
                    disabled={!isSelectable && isMyTurn} 
                    className={`${isMobile ? "scale-[0.75]" : ""} ${isTrump ? 'ring-2 ring-indigo-400 shadow-[0_0_15px_rgba(99,102,241,0.6)]' : ''}`}
                  />
                  {isTrump && (
                    <div className="absolute -top-1 -left-1 w-4 h-4 bg-indigo-500 rounded-full flex items-center justify-center text-[8px] shadow-lg z-10 border border-white/20">
                      ⭐
                    </div>
                  )}
                </div>
              );
            });
          })()}
        </div>

        {/* Modern Comms & Tactics Dock - Bottom Right */}
        <div className="absolute bottom-6 right-6 z-[450] flex flex-col gap-2.5 items-end">
          <AnimatePresence>
            {isTacticalPanelOpen && (
              <motion.div 
                initial={{ scale: 0.9, opacity: 0, y: 15 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.9, opacity: 0, y: 15 }}
                className="glass-panel w-[280px] p-4 rounded-[2rem] border-white/10 backdrop-blur-2xl flex flex-col gap-3 shadow-2xl relative border border-indigo-500/20"
              >
                <div className="flex items-center justify-between border-b border-indigo-500/10 pb-2">
                  <div>
                    <div className="text-[9px] font-black text-transparent bg-clip-text bg-gradient-to-r from-indigo-300 to-amber-300 uppercase tracking-widest">TACTICS & COMMS</div>
                    <div className="text-[6px] font-black text-white/30 uppercase mt-0.5">Coordinated Team Play</div>
                  </div>
                  <button 
                    onClick={() => setIsTacticalPanelOpen(false)}
                    className="w-5 h-5 rounded-full border border-white/10 hover:bg-white/5 text-[8px] flex items-center justify-center font-bold text-white/50"
                  >
                    ✕
                  </button>
                </div>

                {/* Seat Glowing Signals */}
                <div className="space-y-1">
                  <span className="text-[6px] font-black text-indigo-400/80 uppercase tracking-wider block">GLOW TABLE SIGNALS</span>
                  <div className="grid grid-cols-2 gap-1.5 font-sans">
                    <button 
                      onClick={() => toggleSeatSignal('trump_ace')}
                      className={`p-1.5 rounded-xl border text-center transition-all ${
                        gameState.players[myPlayerId]?.activeSignal === 'trump_ace'
                          ? 'bg-amber-500/20 border-amber-400 text-amber-200 shadow-lg'
                          : 'bg-white/5 border-white/5 hover:border-white/15 hover:bg-white/10 text-white/70'
                      }`}
                    >
                      <div className="text-[7.5px] font-black">⭐ YELLOW GLOW</div>
                    </button>
                    <button 
                      onClick={() => toggleSeatSignal('double_guard')}
                      className={`p-1.5 rounded-xl border text-center transition-all ${
                        gameState.players[myPlayerId]?.activeSignal === 'double_guard'
                          ? 'bg-sky-500/20 border-sky-400 text-sky-200 shadow-lg'
                          : 'bg-white/5 border-white/5 hover:border-white/15 hover:bg-white/10 text-white/70'
                      }`}
                    >
                      <div className="text-[7.5px] font-black">🛡️ BLUE GLOW</div>
                    </button>
                  </div>
                </div>

                {/* Card Play Arming */}
                <div className="space-y-1">
                  <span className="text-[6px] font-black text-indigo-400/80 uppercase tracking-wider block">ARM PLAY SIGNS</span>
                  <div className="grid grid-cols-3 gap-1 font-sans">
                    <button 
                      onClick={() => setSelectedSignal(selectedSignal === 'slow' ? null : 'slow')}
                      className={`py-1 rounded-lg border text-center transition-all ${
                        selectedSignal === 'slow'
                          ? 'bg-amber-500/25 border-amber-400 text-amber-200 font-black'
                          : 'bg-white/5 border-white/5 hover:border-white/10 text-white/60 text-[7px]'
                      }`}
                    >
                      <div className="text-[6.5px]">🐢 SLOW</div>
                    </button>
                    <button 
                      onClick={() => setSelectedSignal(selectedSignal === 'spin' ? null : 'spin')}
                      className={`py-1 rounded-lg border text-center transition-all ${
                        selectedSignal === 'spin'
                          ? 'bg-indigo-500/25 border-indigo-400 text-indigo-200 font-black'
                          : 'bg-white/5 border-white/5 hover:border-white/10 text-white/60 text-[7px]'
                      }`}
                    >
                      <div className="text-[6.5px]">🌀 SPIN</div>
                    </button>
                    <button 
                      onClick={() => setSelectedSignal(selectedSignal === 'slam' ? null : 'slam')}
                      className={`py-1 rounded-lg border text-center transition-all ${
                        selectedSignal === 'slam'
                          ? 'bg-red-500/25 border-red-400 text-red-200 font-black'
                          : 'bg-white/5 border-white/5 hover:border-white/10 text-white/60 text-[7px]'
                      }`}
                    >
                      <div className="text-[6.5px]">💥 SLAM</div>
                    </button>
                  </div>
                </div>

                {/* Quick Chat Comms */}
                <div className="space-y-1">
                  <span className="text-[6px] font-black text-indigo-400/80 uppercase tracking-wider block">TALK COMMS (MESSAGES)</span>
                  <div className="grid grid-cols-2 gap-1 max-h-[85px] overflow-y-auto custom-scrollbar pr-1 font-sans">
                    {["Nice play partner! 👏", "Watch the trump! ⚠️", "I got this round! 😎", "Ouch, bad cards... 😢", "Win this! 🔥", "My bad! 🙏"].map((msg, idx) => (
                      <button 
                        key={`chat-opt-${idx}`}
                        onClick={() => sendInGameMessage(msg)}
                        className="p-1 px-1.5 rounded-lg bg-white/5 hover:bg-indigo-500/10 border border-white/5 hover:border-indigo-500/20 text-left text-white/70 text-[7.5px] font-bold leading-tight transition-all truncate"
                      >
                        {msg}
                      </button>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <button 
            onClick={() => setIsTacticalPanelOpen(!isTacticalPanelOpen)}
            className="w-12 h-12 rounded-full glass-panel flex flex-col items-center justify-center border-indigo-500/30 hover:border-indigo-500/60 hover:bg-indigo-600/10 transition-all shadow-[0_4px_25px_rgba(99,102,241,0.25)] relative"
          >
            <span className="text-lg animate-pulse">📢</span>
            <span className="text-[6.5px] font-black text-indigo-400 uppercase leading-none tracking-widest mt-0.5">COMMS</span>
          </button>
        </div>

        {trumpAlert && (
          <div className="fixed top-24 left-1/2 -translate-x-1/2 z-[2000] pointer-events-none">
            <div className="glass-panel p-4 px-8 rounded-3xl border-2 border-indigo-500/50 flex items-center gap-4 shadow-2xl animate-bounce">
              <span className="text-4xl text-indigo-400">{suitIcons[trumpAlert.suit]}</span>
              <div className="text-left">
                <div className="text-[8px] font-black text-indigo-400 uppercase tracking-widest">
                  {trumpAlert.type === 'announced' ? 'TRUMP ANNOUNCED' : 'TRUMP CHALLENGED'}
                </div>
                <div className="text-2xl font-black uppercase">{trumpAlert.suit}</div>
              </div>
            </div>
          </div>
        )}

        {gameState.roundStatus === 'ended' && (() => {
          const isMyTeamAlpha = myPlayerId === 0 || myPlayerId === 2;
          const myTeamScore = isMyTeamAlpha 
            ? (gameState.players[0].score + gameState.players[2].score)
            : (gameState.players[1].score + gameState.players[3].score);
          const opponentTeamScore = isMyTeamAlpha
            ? (gameState.players[1].score + gameState.players[3].score)
            : (gameState.players[0].score + gameState.players[2].score);
          const hasWon = myTeamScore > opponentTeamScore;
          const isTie = myTeamScore === opponentTeamScore;

          return (
            <div className="fixed inset-0 bg-black/95 z-[5000] flex flex-col items-center justify-center p-8 backdrop-blur-3xl text-center">
              <div className={`text-6xl md:text-8xl font-black uppercase mb-4 tracking-tighter ${hasWon ? 'text-green-500' : isTie ? 'text-yellow-500' : 'text-red-500'}`}>
                {hasWon ? 'ROUND WON' : isTie ? 'ROUND TIED' : 'ROUND LOST'}
              </div>
              <h2 className="text-2xl turab-title font-black italic mb-12 opacity-40">MATCH OVER</h2>
              
              <div className="glass-panel p-8 rounded-3xl border-white/10 mb-8 max-w-sm w-full">
                <div className="flex justify-between mb-4">
                  <span className="text-white/40 font-black uppercase text-xs">Your Team (Cards Won)</span>
                  <span className={`text-2xl font-black ${hasWon ? 'text-green-400' : 'text-white'}`}>{myTeamScore}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/40 font-black uppercase text-xs">Opponents (Cards Won)</span>
                  <span className={`text-2xl font-black ${!hasWon && !isTie ? 'text-red-400' : 'text-white'}`}>{opponentTeamScore}</span>
                </div>
                <div className="mt-6 text-[10px] font-black tracking-widest text-white/30 uppercase border-t border-white/5 pt-4">
                  {hasWon 
                    ? `🏆 WINNER: You collected ${myTeamScore} cards!` 
                    : isTie 
                      ? '🤝 TIE: Equal split of 26 cards each!' 
                      : `Opponents won with ${opponentTeamScore} cards!`
                  }
                </div>
              </div>

              <div className="w-full max-w-sm space-y-4">
                <button onClick={() => startNewGame('classic')} className="gold-button w-full py-6 rounded-3xl text-xl">Play Again</button>
                <button onClick={() => setView('home')} className="w-full py-5 bg-white/5 border border-white/10 rounded-3xl text-xs font-black uppercase text-white/40">Back to Lobby</button>
              </div>
            </div>
          );
        })()}
      </div>
    );
  };

  return (
    <ErrorBoundary>
      <div className="h-full w-full relative">
        <Toaster position="top-center" richColors />
        {isAuthLoading ? (
          <div className="fixed inset-0 bg-[#060814] z-[9999] flex flex-col items-center justify-center p-8 text-center select-none overflow-hidden">
            {/* Ambient gold glow */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[350px] h-[350px] bg-indigo-500/10 rounded-full blur-[100px]" />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[250px] h-[250px] bg-amber-500/5 rounded-full blur-[80px]" />
            
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
              className="relative z-10 flex flex-col items-center gap-4"
            >
              {/* Premium Logo Frame */}
              <div className="relative w-24 h-24 rounded-3xl border-2 border-amber-500/40 bg-white/5 flex items-center justify-center shadow-[0_0_50px_rgba(245,158,11,0.15)] mb-2 overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-tr from-indigo-500/20 via-transparent to-amber-500/20 animate-pulse" />
                <span className="text-4xl filter drop-shadow-[0_0_10px_rgba(245,158,11,0.5)]">👑</span>
              </div>

              <h1 className="text-3xl font-black uppercase tracking-[0.4em] text-transparent bg-clip-text bg-gradient-to-r from-amber-200 via-yellow-400 to-amber-200 drop-shadow-[0_2px_15px_rgba(245,158,11,0.2)]">
                TURAB
              </h1>
              <span className="text-[9px] font-black tracking-[0.3em] text-indigo-400 uppercase leading-none">
                ELITE CARD SERIES
              </span>

              {/* Premium Flipping Card Loader */}
              <div className="mt-8 flex flex-col items-center gap-6">
                <FlippingCardLoader />
                <span className="text-[8px] font-black uppercase text-amber-400 tracking-[0.3em] animate-pulse font-mono">
                  SHUFFLING DECKS & LOADING RESOURCES...
                </span>
              </div>
            </motion.div>
          </div>
        ) : (
          renderView()
        )}

        {/* Global Friends Drawer */}
        <AnimatePresence>
          {isFriendsOpen && (
            <>
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setIsFriendsOpen(false)}
                className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[5200]"
              />
              <motion.div 
                initial={{ x: '100%' }}
                animate={{ x: 0 }}
                exit={{ x: '100%' }}
                transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                className="fixed top-0 right-0 h-full w-full max-w-sm glass-panel border-l border-white/10 z-[5201] p-8 flex flex-col"
              >
                <div className="flex items-center justify-between mb-8">
                  <h2 className="text-2xl font-black uppercase tracking-widest text-indigo-400">Social</h2>
                  <button onClick={() => setIsFriendsOpen(false)} className="text-white/40 hover:text-white transition-colors">✕</button>
                </div>

                <div className="flex gap-4 mb-8">
                  <button 
                    onClick={() => setFriendsTab('list')}
                    className={`flex-1 py-3 rounded-xl text-[8px] font-black uppercase tracking-widest transition-all ${friendsTab === 'list' ? 'bg-indigo-600 text-white' : 'bg-white/5 text-white/40'}`}
                  >
                    Friends
                  </button>
                  <button 
                    onClick={() => setFriendsTab('requests')}
                    className={`flex-1 py-3 rounded-xl text-[8px] font-black uppercase tracking-widest transition-all relative ${friendsTab === 'requests' ? 'bg-indigo-600 text-white' : 'bg-white/5 text-white/40'}`}
                  >
                    Requests
                    {friendRequests.length > 0 && (
                      <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[8px] rounded-full flex items-center justify-center animate-pulse">
                        {friendRequests.length}
                      </span>
                    )}
                  </button>
                </div>

                {friendsTab === 'list' ? (
                  <>
                    <div className="space-y-4 mb-8">
                      <div className="relative">
                        <input 
                          type="text" 
                          value={friendSearch}
                          onChange={e => setFriendSearch(e.target.value)}
                          placeholder="SEARCH BY USERNAME" 
                          className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 text-[10px] font-black outline-none focus:border-indigo-500/50 transition-all uppercase placeholder:text-white/20" 
                        />
                        <button 
                          onClick={addFriend}
                          disabled={isSearchingFriend || !friendSearch}
                          className="absolute right-2 top-1/2 -translate-y-1/2 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-xl text-[8px] font-black uppercase transition-all disabled:opacity-50"
                        >
                          {isSearchingFriend ? '...' : 'Add'}
                        </button>
                      </div>
                    </div>

                    <div className="flex-1 overflow-y-auto space-y-4 pr-2 custom-scrollbar">
                      {profile.friends.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-center opacity-20">
                          <div className="text-4xl mb-4">👥</div>
                          <p className="text-[10px] font-black uppercase tracking-widest">No friends yet.<br/>Start building your crew!</p>
                        </div>
                      ) : (
                        profile.friends.map((friend, idx) => (
                          <motion.div 
                            key={`friend-${friend.id}-${idx}`}
                            initial={{ x: 20, opacity: 0 }}
                            animate={{ x: 0, opacity: 1 }}
                            className="glass-panel p-4 rounded-2xl border-white/5 flex items-center gap-4 group"
                          >
                            <div className="w-10 h-10 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-lg relative">
                              👤
                              <div className={`absolute -bottom-1 -right-1 w-3 h-3 rounded-full border-2 border-[#0a0f1e] ${friend.status === 'online' ? 'bg-green-500' : friend.status === 'in-game' ? 'bg-purple-500' : 'bg-gray-500'}`}></div>
                            </div>
                            <div className="flex-1">
                              <div className="text-[10px] font-black uppercase">{friend.username}</div>
                              <div className="text-[8px] font-black text-white/40 uppercase">Level {friend.level}</div>
                            </div>
                            <div className="flex gap-2 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity">
                              <button 
                                onClick={() => inviteToArena(friend)}
                                className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-xs hover:bg-indigo-600/40 transition-all"
                                title="Invite to Arena"
                              >
                                🎮
                              </button>
                              <button 
                                onClick={() => teamupWithFriend(friend)}
                                className="w-8 h-8 rounded-lg bg-emerald-600/20 border border-emerald-500/30 flex items-center justify-center text-xs hover:bg-emerald-600/40 transition-all"
                                title="Teamup for Quick Match"
                              >
                                🤝
                              </button>
                            </div>
                          </motion.div>
                        ))
                      )}
                    </div>
                  </>
                ) : (
                  <div className="flex-1 overflow-y-auto space-y-4 pr-2 custom-scrollbar">
                    {friendRequests.length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center text-center opacity-20">
                        <div className="text-4xl mb-4">📩</div>
                        <p className="text-[10px] font-black uppercase tracking-widest">No pending requests.</p>
                      </div>
                    ) : (
                      friendRequests.map((req, idx) => (
                        <motion.div 
                          key={`req-${req.id}-${idx}`}
                          initial={{ x: 20, opacity: 0 }}
                          animate={{ x: 0, opacity: 1 }}
                          className="glass-panel p-4 rounded-2xl border-white/5 flex items-center gap-4"
                        >
                          <div className="w-10 h-10 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-lg">
                            👤
                          </div>
                          <div className="flex-1">
                            <div className="text-[10px] font-black uppercase">{req.fromUsername}</div>
                            <div className="text-[8px] font-black text-white/40 uppercase">Wants to be friends</div>
                          </div>
                          <div className="flex gap-2">
                            <button 
                              onClick={() => acceptRequest(req)}
                              className="w-8 h-8 rounded-lg bg-emerald-600/20 border border-emerald-500/30 flex items-center justify-center text-[8px] hover:bg-emerald-600/40 transition-all"
                            >
                              ✓
                            </button>
                            <button 
                              onClick={() => rejectRequest(req.id)}
                              className="w-8 h-8 rounded-lg bg-red-600/20 border border-red-500/30 flex items-center justify-center text-[8px] hover:bg-red-600/40 transition-all"
                            >
                              ✕
                            </button>
                          </div>
                        </motion.div>
                      ))
                    )}
                  </div>
                )}
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* Exit Confirmation Modal */}
        <AnimatePresence>
          {isExitConfirmOpen && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 flex items-center justify-center z-[5100]"
            >
              <div 
                onClick={() => setIsExitConfirmOpen(false)}
                className="absolute inset-0 bg-black/85 backdrop-blur-md" 
              />
              <motion.div 
                initial={{ scale: 0.9, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.9, opacity: 0, y: 20 }}
                className="relative w-full max-w-sm glass-panel p-8 rounded-[2.5rem] border-2 border-rose-500/30 bg-black/95 shadow-[-10px_20px_50px_rgba(0,0,0,0.8)] z-[5101] text-center mx-4"
              >
                <div className="w-16 h-16 rounded-full bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-3xl mx-auto mb-6 animate-pulse">
                  ⚠️
                </div>
                <h2 className="text-xl font-black uppercase tracking-widest mb-2 text-rose-400">
                  SURE TO LEAVE ARENA?
                </h2>
                <p className="text-[10px] font-bold text-white/50 uppercase mb-8 leading-relaxed px-2">
                  Leaving an active arena match will result in an automatic forfeit and refund loss of stake! Are you sure you want to exit?
                </p>

                <div className="grid grid-cols-2 gap-4">
                  <button 
                    onClick={() => setIsExitConfirmOpen(false)}
                    className="py-4 rounded-xl bg-white/5 border border-white/5 hover:bg-white/10 text-[10px] uppercase font-black text-white/50 tracking-widest transition-all"
                  >
                    STAY & PLAY
                  </button>
                  <button 
                    onClick={async () => {
                      setIsExitConfirmOpen(false);
                      await leaveCurrentMatch();
                      setView('home');
                      toast.success("Left the game table.");
                    }}
                    className="py-4 rounded-xl bg-rose-600 border border-rose-500/30 hover:bg-rose-500 text-[10px] uppercase font-black text-white tracking-widest hover:shadow-[0_0_20px_rgba(239,68,68,0.4)] transition-all"
                  >
                    YES, SURRENDER
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {view === 'home' && (
          <div className="fixed top-3 right-4 px-2 py-1 bg-black/30 backdrop-blur-md rounded-full text-[9px] font-bold text-white/50 select-none pointer-events-none z-[9999] uppercase tracking-widest border border-white/10">
            v{APP_VERSION}
          </div>
        )}
        <div className="fixed bottom-3 right-4 flex items-center gap-1.5 px-2.5 py-1 bg-black/40 backdrop-blur-md rounded-full text-[9px] font-black tracking-widest text-white/50 select-none pointer-events-none z-[9999] uppercase border border-white/5">
          <span className={`w-1.5 h-1.5 rounded-full ${
            isOffline 
              ? 'bg-rose-500 animate-pulse' 
              : ping === null 
                ? 'bg-yellow-500 animate-pulse' 
                : ping < 80 
                  ? 'bg-emerald-400' 
                  : ping < 180 
                    ? 'bg-amber-400' 
                    : 'bg-rose-500 animate-pulse'
          }`} />
          <span>
            {isOffline 
              ? 'OFFLINE' 
              : ping === null 
                ? 'PING' 
                : `${ping}ms`}
          </span>
        </div>

        <input 
          type="file" 
          ref={avatarInputRef} 
          onChange={handleAvatarChange} 
          accept="image/*" 
          className="hidden" 
        />
      </div>
    </ErrorBoundary>
  );
};

export default App;