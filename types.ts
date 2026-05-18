
export type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades';
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';

export interface Card {
  suit: Suit;
  rank: Rank;
  value: number;
}

export interface Player {
  id: number;
  name: string;
  hand: Card[];
  score: number;
  isAI: boolean;
  consecutiveWins: number;
  lastWinWasAce: boolean;
}

export interface Friend {
  id: string;
  username: string;
  status: 'online' | 'offline' | 'in-game';
  level: number;
}

export interface UserProfile {
  turab_id: string;
  coins: number;
  wins: number;
  losses: number;
  gamesPlayed: number;
  username: string;
  xp: number;
  level: number;
  scraps: number;
  coupons: number;
  skins: string[];
  activeSkin: 'classic' | 'neon' | 'gold' | 'void';
  frames: string[];
  activeFrame: 'none' | 'elite' | 'grandmaster' | 'thunder';
  role: 'admin' | 'user';
  friends: Friend[];
}

export type GameMode = 'classic' | 'private' | 'join';
export type AppView = 'login' | 'home' | 'game' | 'searching' | 'crate' | 'missions' | 'lobby';

export interface FriendRequest {
  id: string;
  fromUid: string;
  fromUsername: string;
  toUid: string;
  status: 'pending' | 'accepted' | 'rejected';
  timestamp: any;
}

export interface GameState {
  id: string;
  players: Player[];
  pile: Card[];
  wonPile: Card[];
  currentTrick: { playerId: number; card: Card }[];
  trumpSuit: Suit | null;
  trumpRevealedInTrick: number | null; // Index of the trick (wonPile.length / 4)
  currentTurn: number;
  leadSuit: Suit | null;
  roundStatus: 'lobby' | 'playing' | 'ended';
  history: string[];
  lastWinner: number | null;
  stake: number;
  tableCode?: string;
  playerUids: string[]; // To track real human players
  mode: 'classic' | 'private';
  createdAt?: any;
  updatedAt?: any;
}

export const RANK_VALUES: Record<Rank, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
  'J': 11, 'Q': 12, 'K': 13, 'A': 14
};

export const SUITS: Suit[] = ['spades', 'hearts', 'diamonds', 'clubs'];
export const RANKS: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
