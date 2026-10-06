import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'motion/react';
import { collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { UserProfile } from '../types';
import { soundEffects } from '../soundEffects';
import { Trophy, Medal, ArrowLeft, RefreshCw, Flame, Crown, Swords, ShieldCheck, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

interface LeaderboardEntry {
  turab_id: string;
  username: string;
  avatar?: string | null;
  wins: number;
  losses: number;
  gamesPlayed: number;
  level: number;
  activeFrame?: 'none' | 'elite' | 'grandmaster' | 'thunder';
}

interface LeaderboardSectionProps {
  currentProfile: UserProfile;
  onBack: () => void;
}

export const LeaderboardSection: React.FC<LeaderboardSectionProps> = ({
  currentProfile,
  onBack
}) => {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchLeaderboard = useCallback(async (isManual = false) => {
    if (isManual) {
      soundEffects.playCardHover();
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }

    try {
      const q = query(
        collection(db, 'users'),
        orderBy('wins', 'desc'),
        limit(10)
      );
      const querySnap = await getDocs(q);

      const entries: LeaderboardEntry[] = [];
      querySnap.forEach((docSnap) => {
        const data = docSnap.data();
        entries.push({
          turab_id: docSnap.id,
          username: data.username || 'Anonymous Player',
          avatar: data.avatar || null,
          wins: Number(data.wins || 0),
          losses: Number(data.losses || 0),
          gamesPlayed: Number(data.gamesPlayed || 0),
          level: Number(data.level || 1),
          activeFrame: data.activeFrame || 'none'
        });
      });

      // If fewer than entries or user isn't present, make sure data is properly sorted
      entries.sort((a, b) => b.wins - a.wins);

      setLeaderboard(entries);
      if (isManual) {
        soundEffects.playCoinClink();
        toast.success("Leaderboard updated!");
      }
    } catch (err) {
      console.warn("Leaderboard fetch fallback:", err);
      // Fallback: If query fails or users collection index isn't ready, display current user & demo elite players
      setLeaderboard([
        {
          turab_id: currentProfile.turab_id || 'player-1',
          username: currentProfile.username || 'You',
          avatar: currentProfile.avatar || null,
          wins: currentProfile.wins || 0,
          losses: currentProfile.losses || 0,
          gamesPlayed: currentProfile.gamesPlayed || 0,
          level: currentProfile.level || 1,
          activeFrame: currentProfile.activeFrame || 'elite'
        }
      ]);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [currentProfile]);

  useEffect(() => {
    fetchLeaderboard();
  }, [fetchLeaderboard]);

  // Determine current user's rank in leaderboard
  const currentUserRankIndex = leaderboard.findIndex(
    item => item.turab_id === currentProfile.turab_id || item.username === currentProfile.username
  );
  const currentUserRank = currentUserRankIndex >= 0 ? currentUserRankIndex + 1 : null;

  // Split top 3 vs 4-10
  const top1 = leaderboard[0];
  const top2 = leaderboard[1];
  const top3 = leaderboard[2];
  const remainingPlayers = leaderboard.slice(3);

  const getFrameBorder = (frame?: string) => {
    switch (frame) {
      case 'thunder':
        return 'border-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.5)]';
      case 'grandmaster':
        return 'border-purple-400 shadow-[0_0_12px_rgba(192,132,252,0.5)]';
      case 'elite':
        return 'border-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.5)]';
      default:
        return 'border-white/20';
    }
  };

  return (
    <div className="relative min-h-screen w-full bg-[#070913] text-white flex flex-col p-4 md:p-8 select-none overflow-y-auto">
      {/* Ambient background glows */}
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[600px] h-[350px] bg-amber-500/10 rounded-full blur-[140px] pointer-events-none" />
      <div className="fixed bottom-0 right-0 w-[400px] h-[300px] bg-purple-600/10 rounded-full blur-[120px] pointer-events-none" />

      {/* Top Header Bar */}
      <div className="max-w-4xl w-full mx-auto flex items-center justify-between mb-8 z-10">
        <button
          onClick={() => {
            soundEffects.playCard();
            onBack();
          }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-2xl glass-panel border border-white/10 hover:border-white/30 text-xs font-black uppercase tracking-wider text-white/80 hover:text-white transition-all cursor-pointer group"
        >
          <ArrowLeft size={16} className="group-hover:-translate-x-1 transition-transform" />
          <span>Back to Home</span>
        </button>

        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchLeaderboard(true)}
            disabled={isRefreshing || isLoading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-2xl glass-panel border border-white/10 hover:border-amber-400/40 text-[10px] font-black uppercase text-amber-400 hover:text-amber-300 transition-all cursor-pointer disabled:opacity-40"
            title="Refresh Leaderboard"
          >
            <RefreshCw size={13} className={isRefreshing ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      {/* Main Title Banner */}
      <div className="max-w-4xl w-full mx-auto text-center mb-8 z-10">
        <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400 text-[8.5px] font-black uppercase tracking-widest mb-3 shadow-md">
          <Trophy size={13} className="text-amber-400 animate-pulse" />
          <span>GLOBAL HALL OF FAME</span>
          <span>•</span>
          <span>TOP 10 WINS</span>
        </div>

        <h1 className="text-3xl md:text-5xl font-black uppercase tracking-tight text-white mb-2">
          CHAMPIONS LEADERBOARD
        </h1>
        <p className="text-xs md:text-sm text-white/60 max-w-md mx-auto">
          The fiercest Court Piece tacticians ranked by total match victories. Claim double sar tricks to etch your name at the top!
        </p>
      </div>

      {/* Content Area */}
      <div className="max-w-4xl w-full mx-auto z-10 space-y-6">
        {isLoading ? (
          /* Loading Skeleton */
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 animate-pulse">
            {[1, 2, 3].map(n => (
              <div key={`skeleton-${n}`} className="h-56 glass-panel rounded-3xl border border-white/5 bg-white/5" />
            ))}
          </div>
        ) : (
          <>
            {/* Top 3 Podium */}
            {leaderboard.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end mb-8 pt-4">
                {/* 2nd Place (Silver) */}
                {top2 && (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="order-2 md:order-1 glass-panel p-5 rounded-[2rem] border border-slate-400/30 bg-gradient-to-b from-slate-800/40 to-black/60 shadow-[0_10px_30px_rgba(0,0,0,0.6)] text-center relative flex flex-col items-center"
                  >
                    <div className="absolute -top-3.5 px-3 py-0.5 rounded-full bg-gradient-to-r from-slate-300 to-slate-400 text-black text-[9px] font-black uppercase tracking-wider shadow flex items-center gap-1">
                      <Medal size={11} /> 2ND PLACE
                    </div>

                    {/* Avatar */}
                    <div className="relative mt-2 mb-3">
                      <div className={`w-16 h-16 rounded-full border-2 overflow-hidden bg-slate-900 flex items-center justify-center ${getFrameBorder(top2.activeFrame)}`}>
                        {top2.avatar ? (
                          <img src={top2.avatar} alt={top2.username} className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-2xl font-black text-slate-300">
                            {top2.username.charAt(0).toUpperCase()}
                          </span>
                        )}
                      </div>
                      <div className="absolute -bottom-1 -right-1 px-1.5 py-0.2 bg-slate-700 border border-slate-500 rounded text-[7px] font-mono font-bold text-white">
                        LV.{top2.level}
                      </div>
                    </div>

                    <div className="text-base font-black text-white truncate max-w-[180px]">
                      {top2.username}
                    </div>

                    <div className="mt-2 px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 w-full flex items-center justify-around">
                      <div>
                        <div className="text-[7.5px] font-bold text-white/40 uppercase">Total Wins</div>
                        <div className="text-sm font-black text-slate-200">{top2.wins} 🏆</div>
                      </div>
                      <div className="h-6 w-px bg-white/10" />
                      <div>
                        <div className="text-[7.5px] font-bold text-white/40 uppercase">Win Rate</div>
                        <div className="text-xs font-mono font-bold text-white/80">
                          {top2.gamesPlayed > 0 ? `${Math.round((top2.wins / top2.gamesPlayed) * 100)}%` : '0%'}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}

                {/* 1st Place (Gold Champion) */}
                {top1 && (
                  <motion.div
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="order-1 md:order-2 glass-panel p-6 rounded-[2.5rem] border-2 border-amber-400/60 bg-gradient-to-b from-amber-500/20 via-[#181106] to-black/80 shadow-[0_15px_40px_rgba(245,158,11,0.3)] text-center relative flex flex-col items-center md:-translate-y-3"
                  >
                    <div className="absolute -top-4 px-3.5 py-1 rounded-full bg-gradient-to-r from-amber-400 via-yellow-400 to-amber-500 text-black text-[9.5px] font-black uppercase tracking-wider shadow-lg flex items-center gap-1.5 animate-pulse">
                      <Crown size={13} /> CHAMPION #1
                    </div>

                    {/* Avatar with crown */}
                    <div className="relative mt-2 mb-3">
                      <div className={`w-20 h-20 rounded-full border-2 overflow-hidden bg-amber-950/60 flex items-center justify-center shadow-[0_0_20px_rgba(245,158,11,0.5)] ${getFrameBorder(top1.activeFrame)}`}>
                        {top1.avatar ? (
                          <img src={top1.avatar} alt={top1.username} className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-3xl font-black text-amber-300">
                            {top1.username.charAt(0).toUpperCase()}
                          </span>
                        )}
                      </div>
                      <div className="absolute -bottom-1 -right-1 px-2 py-0.5 bg-amber-500 text-black font-black rounded-md text-[8px] font-mono shadow">
                        LV.{top1.level}
                      </div>
                    </div>

                    <div className="text-lg font-black text-amber-300 truncate max-w-[200px]">
                      {top1.username}
                    </div>

                    <div className="mt-3 px-4 py-2 rounded-2xl bg-amber-500/10 border border-amber-500/30 w-full flex items-center justify-around shadow-sm">
                      <div>
                        <div className="text-[8px] font-black text-amber-400 uppercase">Victories</div>
                        <div className="text-base font-black text-amber-200">{top1.wins} 👑</div>
                      </div>
                      <div className="h-7 w-px bg-amber-500/20" />
                      <div>
                        <div className="text-[8px] font-black text-amber-400 uppercase">Win Rate</div>
                        <div className="text-sm font-mono font-black text-white">
                          {top1.gamesPlayed > 0 ? `${Math.round((top1.wins / top1.gamesPlayed) * 100)}%` : '0%'}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}

                {/* 3rd Place (Bronze) */}
                {top3 && (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="order-3 md:order-3 glass-panel p-5 rounded-[2rem] border border-amber-700/40 bg-gradient-to-b from-amber-950/30 to-black/60 shadow-[0_10px_30px_rgba(0,0,0,0.6)] text-center relative flex flex-col items-center"
                  >
                    <div className="absolute -top-3.5 px-3 py-0.5 rounded-full bg-gradient-to-r from-amber-700 to-amber-600 text-white text-[9px] font-black uppercase tracking-wider shadow flex items-center gap-1">
                      <Medal size={11} /> 3RD PLACE
                    </div>

                    {/* Avatar */}
                    <div className="relative mt-2 mb-3">
                      <div className={`w-16 h-16 rounded-full border-2 overflow-hidden bg-amber-950 flex items-center justify-center ${getFrameBorder(top3.activeFrame)}`}>
                        {top3.avatar ? (
                          <img src={top3.avatar} alt={top3.username} className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-2xl font-black text-amber-400">
                            {top3.username.charAt(0).toUpperCase()}
                          </span>
                        )}
                      </div>
                      <div className="absolute -bottom-1 -right-1 px-1.5 py-0.2 bg-amber-800 border border-amber-600 rounded text-[7px] font-mono font-bold text-white">
                        LV.{top3.level}
                      </div>
                    </div>

                    <div className="text-base font-black text-white truncate max-w-[180px]">
                      {top3.username}
                    </div>

                    <div className="mt-2 px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 w-full flex items-center justify-around">
                      <div>
                        <div className="text-[7.5px] font-bold text-white/40 uppercase">Total Wins</div>
                        <div className="text-sm font-black text-amber-400">{top3.wins} 🏆</div>
                      </div>
                      <div className="h-6 w-px bg-white/10" />
                      <div>
                        <div className="text-[7.5px] font-bold text-white/40 uppercase">Win Rate</div>
                        <div className="text-xs font-mono font-bold text-white/80">
                          {top3.gamesPlayed > 0 ? `${Math.round((top3.wins / top3.gamesPlayed) * 100)}%` : '0%'}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </div>
            )}

            {/* Ranks 4 to 10 List */}
            {remainingPlayers.length > 0 && (
              <div className="glass-panel p-4 md:p-6 rounded-[2rem] border border-white/10 space-y-2.5">
                <div className="text-[9px] font-black uppercase text-white/40 px-3 pb-1 tracking-wider flex items-center justify-between">
                  <span>RANK & PLAYER</span>
                  <div className="flex gap-12 sm:gap-16">
                    <span>GAMES PLAYED</span>
                    <span>WINS</span>
                  </div>
                </div>

                {remainingPlayers.map((player, idx) => {
                  const rank = idx + 4;
                  const isCurrent = player.turab_id === currentProfile.turab_id;

                  return (
                    <motion.div
                      key={`rank-${player.turab_id}-${rank}`}
                      whileHover={{ scale: 1.01 }}
                      className={`p-3.5 rounded-2xl border transition-all flex items-center justify-between ${
                        isCurrent
                          ? 'border-amber-400 bg-amber-500/15 shadow-[0_0_15px_rgba(245,158,11,0.25)]'
                          : 'border-white/5 bg-white/5 hover:bg-white/10 hover:border-white/15'
                      }`}
                    >
                      {/* Left: Rank & Player info */}
                      <div className="flex items-center gap-3">
                        <div className="w-7 h-7 rounded-xl bg-white/10 font-mono font-black text-xs flex items-center justify-center text-white/70">
                          #{rank}
                        </div>

                        <div className="relative">
                          <div className={`w-10 h-10 rounded-full border overflow-hidden bg-black/60 flex items-center justify-center text-sm font-black ${getFrameBorder(player.activeFrame)}`}>
                            {player.avatar ? (
                              <img src={player.avatar} alt={player.username} className="w-full h-full object-cover" />
                            ) : (
                              <span>{player.username.charAt(0).toUpperCase()}</span>
                            )}
                          </div>
                        </div>

                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-black text-white">
                              {player.username}
                            </span>
                            {isCurrent && (
                              <span className="px-1.5 py-0.2 rounded bg-amber-400 text-black text-[7px] font-black uppercase">
                                YOU
                              </span>
                            )}
                          </div>
                          <div className="text-[8px] font-mono text-white/40 flex items-center gap-1">
                            <span>LV.{player.level}</span>
                            <span>•</span>
                            <span>
                              {player.gamesPlayed > 0 ? `${Math.round((player.wins / player.gamesPlayed) * 100)}% Win Rate` : 'No games'}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Right: Games & Wins */}
                      <div className="flex items-center gap-10 sm:gap-14 text-right">
                        <div className="text-xs font-mono text-white/50">
                          {player.gamesPlayed}
                        </div>
                        <div className="text-sm font-black text-amber-300 min-w-[3rem] text-right flex items-center justify-end gap-1">
                          <span>{player.wins}</span>
                          <span className="text-xs">🏆</span>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}

            {/* Current Player Status Bar */}
            <div className="glass-panel p-4 md:p-5 rounded-[2rem] border border-amber-500/30 bg-gradient-to-r from-amber-500/10 via-orange-950/20 to-black/60 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-xl shadow-inner">
                  🎖️
                </div>
                <div>
                  <div className="text-[8px] font-black uppercase tracking-wider text-amber-400">
                    YOUR PROFILE STATUS
                  </div>
                  <div className="text-sm font-black text-white flex items-center gap-2">
                    <span>{currentProfile.username}</span>
                    <span className="text-xs font-mono text-amber-300">
                      {currentUserRank ? `Rank #${currentUserRank}` : 'Top 10 Contender'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-4 text-right">
                <div>
                  <div className="text-[7.5px] font-bold text-white/40 uppercase">Your Wins</div>
                  <div className="text-base font-black text-amber-400">
                    {currentProfile.wins || 0} 🏆
                  </div>
                </div>
                <div className="h-7 w-px bg-white/10" />
                <div>
                  <div className="text-[7.5px] font-bold text-white/40 uppercase">Win Rate</div>
                  <div className="text-xs font-mono font-bold text-white/80">
                    {currentProfile.gamesPlayed > 0 
                      ? `${Math.round((currentProfile.wins / currentProfile.gamesPlayed) * 100)}%` 
                      : '0%'}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default LeaderboardSection;
