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

const INITIAL_COINS = 500;
const STAKE_AMOUNT = 200;
const APP_VERSION = '1.3.3';

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
  const [lobbyPlayerNames, setLobbyPlayerNames] = useState<Record<string, string>>({});
  const processingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const setSafeProcessing = useCallback((val: boolean) => {
    setIsProcessing(val);
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
  const [trumpAlert, setTrumpAlert] = useState<{ suit: Suit; playerName: string; type: 'announced' | 'challenged' } | null>(null);
  const [isThunderActive, setIsThunderActive] = useState(false);
  const [hoveredCardKey, setHoveredCardKey] = useState<string | null>(null);
  
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
  
  // Sync Firebase Profile
  const [friendRequests, setFriendRequests] = useState<FriendRequest[]>([]);
  const [isRequestsOpen, setIsRequestsOpen] = useState(false);
  
  // PeerJS for Human-to-Human Voice Chat
  const [isPeerVoiceActive, setIsPeerVoiceActive] = useState(false);
  const peerRef = useRef<Peer | null>(null);
  const callsRef = useRef<any[]>([]);

  const [isFriendsOpen, setIsFriendsOpen] = useState(false);
  const [friendSearch, setFriendSearch] = useState('');
  const [isSearchingFriend, setIsSearchingFriend] = useState(false);
  const [friendsTab, setFriendsTab] = useState<'list' | 'requests'>('list');
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

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

  const addFriend = async () => {
    if (!friendSearch) return;
    setIsSearchingFriend(true);
    try {
      // First try searching by Turab ID (User UID)
      let friendDoc: any = await getDoc(doc(db, 'users', friendSearch)).catch(() => null);
      
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
  const initPeerVoice = useCallback(async () => {
    if (peerRef.current) return;

    const peer = new Peer(auth.currentUser!.uid);
    peerRef.current = peer;

    peer.on('call', async (call) => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      call.answer(stream);
      call.on('stream', (remoteStream) => {
        const audio = new Audio();
        audio.srcObject = remoteStream;
        audio.play();
      });
      callsRef.current.push(call);
    });

    setIsPeerVoiceActive(true);
  }, []);

  const callPlayers = useCallback(async (playerUids: string[]) => {
    if (!peerRef.current) return;

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    playerUids.forEach(uid => {
      if (uid !== auth.currentUser!.uid) {
        const call = peerRef.current!.call(uid, stream);
        call.on('stream', (remoteStream) => {
          const audio = new Audio();
          audio.srcObject = remoteStream;
          audio.play();
        });
        callsRef.current.push(call);
      }
    });
  }, []);

  const cleanupPeerVoice = useCallback(() => {
    callsRef.current.forEach(call => call.close());
    callsRef.current = [];
    if (peerRef.current) {
      peerRef.current.destroy();
      peerRef.current = null;
    }
    setIsPeerVoiceActive(false);
  }, []);

  const inviteToArena = (friend: Friend) => {
    const code = 'INV-' + Math.random().toString(36).substring(7).toUpperCase();
    toast.success(`Invitation sent to ${friend.username}!`);
    startNewGame('private', code);
    setIsFriendsOpen(false);
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
            }
          }
        };

        fetchProfile();
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

  const playerHandSorted = useMemo(() => {
    if (!gameState) return [];
    return sortHand(gameState.players[0].hand, gameState.trumpSuit);
  }, [gameState]);

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
      toast.error('Microphone access failed.');
      await cleanupMic();
    } finally {
      isConnectingRef.current = false;
    }
  };

  // Listen for Friend Requests
  useEffect(() => {
    if (!auth.currentUser) return;
    const q = query(collection(db, 'friend_requests'), where('toUid', '==', auth.currentUser.uid), where('status', '==', 'pending'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const reqs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as FriendRequest));
      setFriendRequests(reqs);
      if (reqs.length > 0) {
        toast.info(`You have ${reqs.length} new friend request(s)!`);
      }
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'friend_requests'));
    return () => unsubscribe();
  }, []);

  const setupMatch = useCallback(async (code?: string, mode: 'classic' | 'private' = 'classic') => {
    // Generate a 6-digit numeric code for private matches
    const numericCode = Math.floor(100000 + Math.random() * 900000).toString();
    const matchId = code || (mode === 'private' ? numericCode : 'MATCH-' + Math.random().toString(36).substring(7).toUpperCase());
    
    console.log(`🛠 Setting up ${mode} match: ${matchId}`);
    
    const players: Player[] = [
      { id: 0, name: profile.username, hand: [], score: 0, isAI: false, consecutiveWins: 0, lastWinWasAce: false },
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
    
    initPeerVoice();
  }, [profile.username, initPeerVoice, handleFirestoreError]);

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

  const startNewGame = useCallback(async (mode: GameMode, code?: string) => {
    const isAdmin = profile.role === 'admin';
    if (!isAdmin && profile.coins < STAKE_AMOUNT) return toast.error("Insufficient coins.");
    
    console.log(`🎮 Initializing ${mode} game...`);
    const updatedProfile = { ...profile, coins: isAdmin ? profile.coins : profile.coins - STAKE_AMOUNT, gamesPlayed: profile.gamesPlayed + 1 };
    setProfile(updatedProfile);
    await syncProfileToCloud(updatedProfile);
    
    if (mode === 'classic') {
      setView('searching');
      try {
        const q = query(
          collection(db, 'matches'), 
          where('mode', '==', 'classic'), 
          where('roundStatus', '==', 'lobby'), 
          limit(5) // Reduced limit for faster response
        );
        
        const snap = await getDocs(q);
        let matchToJoin = null;
        
        for (const d of snap.docs) {
          const data = d.data() as GameState;
          if (data.playerUids.length < 4) { 
            matchToJoin = { id: d.id, ...data }; 
            break; 
          }
        }
        
        if (matchToJoin) {
          console.log("🤝 Joining existing match:", matchToJoin.id);
          const newState = { ...matchToJoin, playerUids: [...matchToJoin.playerUids, auth.currentUser!.uid] };
          setGameState(newState as any);
          await updateDoc(doc(db, 'matches', matchToJoin.id), { 
            playerUids: arrayUnion(auth.currentUser?.uid), 
            updatedAt: serverTimestamp() 
          });
        } else {
          console.log("✨ Creating fresh match...");
          const matchId = 'MATCH-' + Math.random().toString(36).substring(7).toUpperCase();
          await setupMatch(matchId, 'classic');
        }
      } catch (err) {
        console.error("Matchmaking error:", err);
        toast.error("Network issue. Reverting...");
        setView('home');
      }
    } else {
      await setupMatch(undefined, 'private');
      setView('lobby');
    }
  }, [profile, setupMatch, syncProfileToCloud]);

  const isProcessingRef = useRef(false);

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
        const updatedPlayers = [...(data.players || [])];
        const validUids = (data.playerUids || []).filter(uid => !!uid);
        
        // Use placeholder names initially if we can't fetch them all inside transaction
        // Transactions should be fast, so we don't fetch users here. 
        // We rely on previous fetch or default names.
        
        validUids.forEach((uid, index) => {
          if (index < 4) {
            updatedPlayers[index] = { 
              ...(updatedPlayers[index] || { id: index, score: 0, consecutiveWins: 0, lastWinWasAce: false, isAI: false }),
              name: lobbyPlayerNames[uid] || (uid === auth.currentUser?.uid ? profile.username : 'Player'), 
              hand: deck.slice(index * 13, (index + 1) * 13),
              isAI: false
            };
          }
        });

        for (let i = validUids.length; i < 4; i++) {
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

  useEffect(() => {
    if (!gameState?.id || (view !== 'game' && view !== 'lobby' && view !== 'searching')) return;
    
    const unsubscribe = onSnapshot(doc(db, 'matches', gameState.id), (snap) => {
      if (snap.exists()) {
        const data = snap.data() as GameState;
        setGameState(prev => {
          if (!prev) return data;
          if (JSON.stringify(data) === JSON.stringify(prev)) return prev;
          
          if (data.roundStatus === 'playing' && prev.roundStatus !== 'playing') {
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
  }, [gameState?.id, view, startMatchFromLobby]);

  const playCardSound = useCallback(() => {
    const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/261/261-preview.mp3');
    audio.volume = 0.2;
    audio.play().catch(() => {});
  }, []);

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
    if (!gameState || isProcessing || gameState.currentTrick.length >= 4 || gameState.currentTurn !== playerId) return;
    if (gameState.leadSuit && card.suit !== gameState.leadSuit && gameState.players[playerId].hand.some(c => c.suit === gameState.leadSuit)) return;
    
    setSafeProcessing(true);
    const matchRef = doc(db, 'matches', gameState.id);

    try {
      await runTransaction(db, async (transaction) => {
        const sfDoc = await transaction.get(matchRef);
        if (!sfDoc.exists()) throw "Match does not exist!";
        
        const data = sfDoc.data() as GameState;
        if (data.currentTurn !== playerId) throw "Wait for your turn.";
        if (data.currentTrick.length >= 4) throw "Trick already full.";

        let newTrump = data.trumpSuit;
        let newTrumpRev = data.trumpRevealedInTrick;
        const trickIdx = data.wonPile.length / 4;

        if (data.leadSuit && card.suit !== data.leadSuit && data.trumpSuit === null) {
          newTrump = card.suit;
          newTrumpRev = trickIdx;
          // Note: setTrumpAlert and setIsThunderActive are local effects, 
          // we can call them here or after transaction success
        }

        const updatedPlayers = data.players.map(p => 
          p.id === playerId 
            ? { ...p, hand: p.hand.filter(c => c.suit !== card.suit || c.rank !== card.rank) } 
            : p
        );

        transaction.update(matchRef, { 
          players: updatedPlayers, 
          currentTrick: [...data.currentTrick, { playerId, card }], 
          leadSuit: data.leadSuit || card.suit, 
          trumpSuit: newTrump, 
          trumpRevealedInTrick: newTrumpRev, 
          currentTurn: (data.currentTurn + 1) % 4,
          updatedAt: serverTimestamp()
        });

        // Trigger side effects locally if it was trump reveal
        if (newTrump !== data.trumpSuit) {
          setTrumpAlert({ suit: card.suit, playerName: data.players[playerId].name, type: 'announced' });
          setIsThunderActive(true);
          setTimeout(() => { setIsThunderActive(false); setTrumpAlert(null); }, 2000);
        }
      });
      playCardSound();
    } catch (err: any) {
      console.error("Play Transaction Failed:", err);
      toast.error(typeof err === 'string' ? err : "Sync error, try again.");
    } finally {
      setSafeProcessing(false);
    }
  }, [gameState, isProcessing, playCardSound]);

  useEffect(() => {
    if (gameState?.roundStatus === 'playing' && gameState.players[gameState.currentTurn].isAI && !isProcessing && gameState.currentTrick.length < 4) {
      const t = setTimeout(() => {
        const p = gameState.players[gameState.currentTurn];
        const valid = gameState.leadSuit ? p.hand.filter(c => c.suit === gameState.leadSuit) : p.hand;
        const card = (valid.length > 0 ? valid : p.hand)[Math.floor(Math.random() * (valid.length || p.hand.length))];
        if (card) playCard(p.id, card);
      }, 1000);
      return () => clearTimeout(t);
    }
  }, [gameState?.currentTurn, isProcessing, gameState?.roundStatus, gameState?.leadSuit, playCard]);

  useEffect(() => {
    if (!gameState || gameState.currentTrick.length !== 4 || isProcessing) return;
    const trickId = gameState.currentTrick.map(t => `${t.playerId}-${t.card.suit}-${t.card.rank}`).join('|');
    if (resolvingTrickRef.current === trickId) return;
    
    // Only the host resolves the trick to avoid multi-transaction overhead, 
    // but we add a safety check.
    if (gameState.playerUids[0] !== auth.currentUser?.uid) return;
    
    resolvingTrickRef.current = trickId;
    const t = setTimeout(async () => {
      setSafeProcessing(true);
      try {
        const matchRef = doc(db, 'matches', gameState.id);
        await runTransaction(db, async (transaction) => {
          const sfDoc = await transaction.get(matchRef);
          if (!sfDoc.exists()) return;
          const data = sfDoc.data() as GameState;
          if (data.currentTrick.length !== 4) return;

          const winnerId = determineTrickWinner(data.currentTrick, data.leadSuit!, data.trumpSuit);
          const winTeam = (winnerId === 0 || winnerId === 2) ? [0, 2] : [1, 3];
          let players = [...data.players];
          let pile = [...data.pile, ...data.currentTrick.map(tr => tr.card)];
          let wonPile = [...data.wonPile];
          const isLast = players.every(p => p.hand.length === 0);
          const bestCard = data.currentTrick.find(tr => tr.playerId === winnerId)!.card;
          const isAce = bestCard.rank === 'A';
          const hasCons = players[winnerId].consecutiveWins >= 1;
          
          if (isLast || (hasCons && data.trumpSuit && !(hasCons && players[winnerId].lastWinWasAce && isAce))) {
            players = players.map(p => winTeam.includes(p.id) ? { ...p, score: p.score + pile.length, consecutiveWins: 0, lastWinWasAce: false } : { ...p, consecutiveWins: 0, lastWinWasAce: false });
            wonPile = [...wonPile, ...pile];
            pile = [];
          } else {
            players = players.map(p => p.id === winnerId ? { ...p, consecutiveWins: p.consecutiveWins + 1, lastWinWasAce: isAce } : { ...p, consecutiveWins: 0, lastWinWasAce: false });
          }

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

          // Secondary side effect for Host
          if (wonPile.length === 52 && winnerId === 0) {
            const up = { ...profile, xp: profile.xp + 150, wins: profile.wins + 1 };
            // syncProfileToCloud will run after transaction completes
            setProfile(up);
            syncProfileToCloud(up);
          }
        });
      } catch (err) { 
        console.error("Trick Resolve Failed:", err);
        // Clear ref on failure so it can retry
        resolvingTrickRef.current = "";
      } finally { 
        setSafeProcessing(false); 
      }
    }, 1500);
    return () => clearTimeout(t);
  }, [gameState, isProcessing, profile, syncProfileToCloud, determineTrickWinner]);

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
    if (!gameState || view !== 'lobby') return;
    
    const fetchNames = async () => {
      const names = { ...lobbyPlayerNames };
      let changed = false;
      for (const uid of gameState.playerUids) {
        if (!names[uid]) {
          const uSnap = await getDoc(doc(db, 'users', uid));
          if (uSnap.exists()) {
            names[uid] = uSnap.data().username;
            changed = true;
          }
        }
      }
      if (changed) setLobbyPlayerNames(names);
    };
    
    fetchNames();
  }, [gameState?.playerUids, view]);

  const [searchingStartTime, setSearchingStartTime] = useState<number | null>(null);
  const [countdown, setCountdown] = useState(10);

  useEffect(() => {
    if (view === 'searching' && gameState?.id) {
      if (!searchingStartTime) setSearchingStartTime(Date.now());
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

  // Auto-start classic matches after timeout if 2+ players (Host only)
  useEffect(() => {
    if (view !== 'searching' || !gameState || gameState.mode !== 'classic' || gameState.roundStatus !== 'lobby' || !searchingStartTime) return;
    if (gameState.playerUids[0] !== auth.currentUser?.uid) return;
    if (gameState.playerUids.length < 2) return;

    if (countdown <= 0) {
      console.log("🚀 Auto-starting classic match with AIs due to timeout...");
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
            
            {playerCount >= 2 && gameState?.mode === 'classic' && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-8 flex flex-col items-center gap-3"
              >
                <div className="flex items-center gap-2 px-4 py-2 bg-indigo-500/10 border border-indigo-500/20 rounded-full">
                  <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-pulse" />
                  <span className="text-[9px] font-black uppercase tracking-widest text-indigo-400">Stable Match Found</span>
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
                onClick={() => {
                  setGameState(null);
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
          className="h-[100dvh] w-full flex flex-col items-center justify-center bg-transparent p-8"
        >
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="glass-panel p-6 md:p-10 rounded-3xl md:rounded-[2.5rem] border-white/10 w-full max-w-md text-center relative overflow-hidden"
          >
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
                    <div className="w-8 h-8 rounded-full bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-[10px]">
                      {lobbyPlayerNames[uid]?.[0]?.toUpperCase() || 'P'}
                    </div>
                    <span className="font-black uppercase text-xs">
                      {lobbyPlayerNames[uid] || (uid === auth.currentUser?.uid ? profile.username : 'Elite Player')}
                    </span>
                  </div>
                  <span className="text-[8px] font-black text-emerald-400 uppercase bg-emerald-400/10 px-2 py-1 rounded">Connected</span>
                </div>
              ))}
              {Array.from({ length: 4 - (gameState?.playerUids.length || 0) }).map((_, i) => (
                <div key={`lobby-waiting-${i}`} className="flex items-center justify-between p-4 bg-white/5 rounded-xl border border-white/10 opacity-30">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-[10px]">?</div>
                    <span className="font-black uppercase text-xs text-white/20">Awaiting...</span>
                  </div>
                  <span className="text-[6px] font-black text-white/10 uppercase">Slot {(gameState?.playerUids.length || 0) + i + 1}</span>
                </div>
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
                onClick={() => setView('home')}
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
              <div className="w-14 h-14 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-2xl shadow-inner relative z-10">
                👤
                <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-indigo-600 border-2 border-[#0a0f1e] flex items-center justify-center text-[8px] font-black">
                  {profile.level}
                </div>
              </div>
              <div className="flex-1 relative z-10 text-left">
                <div className="flex items-center justify-between mb-1">
                  <div className={`text-[7px] font-black uppercase tracking-widest px-2 py-0.5 rounded ${userRank.bg} ${userRank.color} border ${userRank.border} w-fit`}>{userRank.title}</div>
                  <div 
                    onClick={() => {
                      navigator.clipboard.writeText(profile.turab_id);
                      toast.success("ID copied!");
                    }}
                    className="text-[6px] font-mono text-white/20 hover:text-indigo-400 transition-colors cursor-pointer flex items-center gap-1"
                  >
                    ID: {profile.turab_id.slice(0, 8)}... 📋
                  </div>
                </div>
                <h2 className="text-xl font-black tracking-tight">{profile.username}</h2>
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

              <motion.button whileHover={{ y: -2 }} onClick={() => setIsFriendsOpen(true)} className="glass-panel w-full py-5 rounded-2xl text-[10px] font-black uppercase border-white/10 hover:bg-white/5 transition-all">
                Friends & Social
              </motion.button>

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

          {/* Friends Drawer */}
          <AnimatePresence>
            {isFriendsOpen && (
              <>
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setIsFriendsOpen(false)}
                  className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200]"
                />
                <motion.div 
                  initial={{ x: '100%' }}
                  animate={{ x: 0 }}
                  exit={{ x: '100%' }}
                  transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                  className="fixed top-0 right-0 h-full w-full max-w-sm glass-panel border-l border-white/10 z-[201] p-8 flex flex-col"
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
                              <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button 
                                  onClick={() => inviteToArena(friend)}
                                  className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-xs hover:bg-indigo-600/40 transition-all"
                                  title="Invite to Arena"
                                >
                                  🎮
                                </button>
                                <button 
                                  onClick={() => {
                                    toast.success(`Teamup request sent to ${friend.username}!`);
                                    startNewGame('classic');
                                    setIsFriendsOpen(false);
                                  }}
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

        <div className="absolute top-0 left-0 p-4 md:p-6 z-[150]">
          <div className="flex gap-2">
            <button onClick={() => setView('home')} className="glass-panel w-10 h-10 rounded-full flex items-center justify-center">←</button>
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
          {gameState.players.map((p, i) => {
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
                {p.id !== 0 && (
                  <div className={`absolute ${fanPositions[i]} pointer-events-none z-20`}>
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
                <div className={`absolute ${positions[i]} z-[100] flex flex-col items-center`}>
                  <div className={`w-12 h-12 rounded-full glass-panel flex items-center justify-center text-xl border-2 ${isCurrentTurn ? 'border-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.5)]' : 'border-white/10'}`}>
                    {i === 0 ? '👤' : '🤖'}
                  </div>
                  <div className="text-[8px] font-black uppercase mt-1 bg-black/60 px-2 py-0.5 rounded border border-white/5">{p.name}</div>
                  <div className="text-[10px] font-black text-indigo-400">{p.score}</div>
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
            {gameState.currentTrick.map((t, idx) => {
              const offsets = [
                "translate-y-[70px] md:translate-y-[120px]", // South
                "-translate-x-[70px] md:-translate-x-[120px]", // West
                "-translate-y-[70px] md:-translate-y-[120px]", // North
                "translate-x-[70px] md:translate-x-[120px]"  // East
              ];
              const isWinning = currentTrickWinnerId === t.playerId;
              const isTrump = gameState.trumpSuit === t.card.suit;
              
              return (
                <div key={`trick-card-${t.playerId}-${t.card.suit}-${t.card.rank}-${idx}`} className={`absolute z-[50] ${offsets[t.playerId]}`}>
                  <div className={`animate-deal ${isTrump ? 'animate-trump-play' : ''}`}>
                    <div className="relative">
                      <CardComponent 
                        card={t.card} 
                        skin={profile.activeSkin} 
                        className={`scale-75 md:scale-100 shadow-2xl transition-all duration-300 ${isWinning ? 'winner-highlight' : ''} ${isTrump ? 'shadow-[0_0_30px_rgba(99,102,241,0.8)]' : ''}`} 
                      />
                      <div className={`absolute -top-4 -right-4 w-10 h-10 rounded-full glass-panel border-2 flex items-center justify-center text-lg shadow-2xl z-[60] ${isWinning ? 'border-yellow-400 bg-yellow-400/20' : 'border-white/30 bg-indigo-900/80'}`}>
                        {t.playerId === 0 ? '👤' : '🤖'}
                      </div>
                      {isWinning && (
                        <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 bg-yellow-400 text-black text-[10px] font-black px-3 py-1 rounded-full uppercase whitespace-nowrap shadow-[0_0_15px_rgba(251,191,36,0.5)] border border-black/20 animate-pulse">
                          Winning
                        </div>
                      )}
                      {isTrump && (
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

        <div 
          className="card-wing-container w-full max-w-[100vw]"
          onTouchMove={(e) => {
            const touch = e.touches[0];
            const elem = document.elementFromPoint(touch.clientX, touch.clientY);
            const cardElem = elem?.closest('.wing-card');
            if (cardElem) {
              const key = cardElem.getAttribute('data-card-key');
              if (key) setHoveredCardKey(key);
            }
          }}
          onTouchEnd={() => setHoveredCardKey(null)}
        >
          {playerHandSorted.map((card, idx) => {
            const cardKey = `${card.suit}-${card.rank}-${idx}`;
            const isMyTurn = gameState.currentTurn === 0 && !isProcessing && gameState.currentTrick.length < 4;
            const isSelectable = isMyTurn && (!gameState.leadSuit || card.suit === gameState.leadSuit || !gameState.players[0].hand.some(c => c.suit === gameState.leadSuit));
            
            // Fanning logic
            const total = playerHandSorted.length;
            const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
            
            // Dynamic angle step to fit all cards on screen
            // Tightened fanning (lower maxSpan, smaller angles)
            const maxSpan = isMobile ? 28 : 45;
            const angleStep = Math.min(isMobile ? 2.5 : 3.5, maxSpan / Math.max(total, 1)); 
            
            const startAngle = -((total - 1) * angleStep) / 2;
            const angle = startAngle + idx * angleStep;
            
            // Adjust radius for a smooth bowl shape
            const radius = isMobile ? 500 : 800; 
            const x = radius * Math.sin((angle * Math.PI) / 180);
            const y = radius - radius * Math.cos((angle * Math.PI) / 180);

            const isTrump = gameState.trumpSuit === card.suit;
            
            // Pop-up logic: 
            // 1. Specific card hovered (individual tracking)
            // 2. Lead suit (gameplay focus)
            const isCardHovered = hoveredCardKey === cardKey;
            // Also pop the whole suit if a card of that suit is hovered (optional, user wanted individual switch)
            // but usually you want to see the whole suit. Let's make the specific card pop MORE.
            const hoveredCardObj = hoveredCardKey ? playerHandSorted.find((_, i) => `${playerHandSorted[i].suit}-${playerHandSorted[i].rank}-${i}` === hoveredCardKey) : null;
            const isSuitHovered = hoveredCardObj && card.suit === hoveredCardObj.suit;
            
            const isLeadSuitPop = isMyTurn && gameState.leadSuit && card.suit === gameState.leadSuit;
            
            let popupOffset = 0;
            if (isCardHovered) {
              popupOffset = isMobile ? -50 : -75; // Extra pop for the specific card
            } else if (isSuitHovered || isLeadSuitPop) {
              popupOffset = isMobile ? -30 : -45; // Normal pop for the suit/lead group
            }

            const handleCardPlay = () => {
              setHoveredCardKey(null);
              playCard(0, card);
            };

            return (
              <div 
                key={cardKey} 
                className="wing-card"
                data-card-key={cardKey}
                onMouseEnter={() => setHoveredCardKey(cardKey)}
                onMouseLeave={() => setHoveredCardKey(null)}
                style={{
                  transform: `translate(${x}px, ${y + popupOffset}px) rotate(${angle}deg)`,
                  zIndex: isCardHovered ? 3000 : ((isSuitHovered || isLeadSuitPop) ? 2000 : idx)
                }}
              >
                <CardComponent 
                  card={card} 
                  skin={profile.activeSkin} 
                  onClick={handleCardPlay} 
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
          })}
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

        {gameState.roundStatus === 'ended' && (
          <div className="fixed inset-0 bg-black/95 z-[5000] flex flex-col items-center justify-center p-8 backdrop-blur-3xl text-center">
            <div className={`text-6xl md:text-8xl font-black uppercase mb-4 tracking-tighter ${teamAlphaScore > 26 ? 'text-green-500' : 'text-red-500'}`}>
              {teamAlphaScore > 26 ? 'ROUND WON' : 'ROUND LOST'}
            </div>
            <h2 className="text-2xl turab-title font-black italic mb-12 opacity-40">MATCH OVER</h2>
            
            <div className="glass-panel p-8 rounded-3xl border-white/10 mb-8 max-w-sm w-full">
              <div className="flex justify-between mb-4">
                <span className="text-white/40 font-black uppercase text-xs">Your Team</span>
                <span className="text-2xl font-black text-green-400">{teamAlphaScore}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/40 font-black uppercase text-xs">Opponents</span>
                <span className="text-2xl font-black text-red-400">{52 - teamAlphaScore}</span>
              </div>
            </div>

            <div className="w-full max-w-sm space-y-4">
              <button onClick={() => startNewGame('classic')} className="gold-button w-full py-6 rounded-3xl text-xl">Play Again</button>
              <button onClick={() => setView('home')} className="w-full py-5 bg-white/5 border border-white/10 rounded-3xl text-xs font-black uppercase text-white/40">Back to Lobby</button>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <ErrorBoundary>
      <div className="h-full w-full relative">
        <Toaster position="top-center" richColors />
        {renderView()}
        <div className="fixed top-3 right-4 px-2 py-1 bg-black/30 backdrop-blur-md rounded-full text-[9px] font-bold text-white/50 select-none pointer-events-none z-[9999] uppercase tracking-widest border border-white/10">
          v{APP_VERSION}
        </div>
      </div>
    </ErrorBoundary>
  );
};

export default App;