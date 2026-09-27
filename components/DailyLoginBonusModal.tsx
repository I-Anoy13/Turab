import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { UserProfile } from '../types';
import { soundEffects } from '../soundEffects';
import { triggerVictoryConfetti } from '../confettiCelebration';
import { toast } from 'sonner';
import { Flame, Check, Sparkles, Gift, Lock, Calendar, Trophy } from 'lucide-react';

export interface DailyReward {
  day: number;
  coins: number;
  scraps?: number;
  coupons?: number;
  isGrandPrize?: boolean;
}

export const DAILY_LOGIN_REWARDS: DailyReward[] = [
  { day: 1, coins: 50 },
  { day: 2, coins: 100 },
  { day: 3, coins: 150, scraps: 1 },
  { day: 4, coins: 200 },
  { day: 5, coins: 300, scraps: 2 },
  { day: 6, coins: 400 },
  { day: 7, coins: 750, coupons: 1, isGrandPrize: true }
];

export const getLocalDateString = (d: Date = new Date()): string => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const getYesterdayDateString = (): string => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return getLocalDateString(d);
};

/**
 * Calculates current streak info based on last login bonus date:
 * - isClaimedToday: boolean
 * - nextDayToClaim: 1..7
 * - isStreakBroken: boolean
 */
export const evaluateDailyBonusStatus = (profile: UserProfile) => {
  const todayStr = getLocalDateString();
  const yesterdayStr = getYesterdayDateString();
  const lastDate = profile.lastLoginBonusDate;
  const currentStreak = profile.dailyStreak || 0;

  if (lastDate === todayStr) {
    // Already claimed today
    return {
      canClaimToday: false,
      activeDay: currentStreak === 0 ? 1 : ((currentStreak - 1) % 7) + 1,
      isStreakBroken: false,
      consecutiveDays: currentStreak
    };
  }

  if (lastDate === yesterdayStr) {
    // Consecutive login!
    const nextDay = (currentStreak % 7) + 1;
    return {
      canClaimToday: true,
      activeDay: nextDay,
      isStreakBroken: false,
      consecutiveDays: currentStreak
    };
  }

  // Streak broken or brand new account
  return {
    canClaimToday: true,
    activeDay: 1,
    isStreakBroken: Boolean(lastDate && lastDate !== yesterdayStr),
    consecutiveDays: 0
  };
};

interface DailyLoginBonusModalProps {
  isOpen: boolean;
  onClose: () => void;
  profile: UserProfile;
  setProfile: React.Dispatch<React.SetStateAction<UserProfile>>;
  syncProfileToCloud: (updatedProfile: UserProfile) => Promise<void>;
}

export const DailyLoginBonusModal: React.FC<DailyLoginBonusModalProps> = ({
  isOpen,
  onClose,
  profile,
  setProfile,
  syncProfileToCloud
}) => {
  const [isClaiming, setIsClaiming] = useState(false);
  const status = evaluateDailyBonusStatus(profile);
  const todayStr = getLocalDateString();

  const handleClaim = async () => {
    if (!status.canClaimToday || isClaiming) return;

    setIsClaiming(true);
    soundEffects.playVictoryFanfare();
    triggerVictoryConfetti();

    const targetDayIndex = status.activeDay - 1;
    const reward = DAILY_LOGIN_REWARDS[targetDayIndex];

    const updatedProfile: UserProfile = {
      ...profile,
      coins: profile.coins + reward.coins,
      scraps: (profile.scraps || 0) + (reward.scraps || 0),
      coupons: (profile.coupons || 0) + (reward.coupons || 0),
      dailyStreak: status.activeDay,
      lastLoginBonusDate: todayStr
    };

    setProfile(updatedProfile);
    await syncProfileToCloud(updatedProfile);

    setIsClaiming(false);

    let rewardDesc = `+${reward.coins} Coins 🪙`;
    if (reward.scraps) rewardDesc += ` & +${reward.scraps} Scraps 🎟️`;
    if (reward.coupons) rewardDesc += ` & +${reward.coupons} Crate Coupon 🎫`;

    toast.success(`🎉 Day ${reward.day} Login Bonus Claimed! ${rewardDesc}`, {
      duration: 5000
    });
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 flex items-center justify-center z-[600] p-4 select-none">
        {/* Dark Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-black/85 backdrop-blur-md"
        />

        {/* Modal Container */}
        <motion.div
          initial={{ scale: 0.85, opacity: 0, y: 30 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.85, opacity: 0, y: 30 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="relative w-full max-w-lg glass-panel p-6 md:p-8 rounded-[2.5rem] border border-amber-500/40 bg-gradient-to-b from-[#180e04] via-[#0d0f1a] to-[#080914] shadow-[0_20px_60px_rgba(0,0,0,0.9)] z-10 text-center overflow-hidden"
        >
          {/* Ambient golden top glow */}
          <div className="absolute -top-16 left-1/2 -translate-x-1/2 w-64 h-32 bg-amber-500/20 rounded-full blur-3xl pointer-events-none" />

          {/* Close X */}
          <button
            onClick={onClose}
            className="absolute top-5 right-5 w-8 h-8 rounded-full border border-white/10 hover:border-white/30 hover:bg-white/10 flex items-center justify-center text-xs font-black text-white/50 hover:text-white transition-all cursor-pointer z-20"
            title="Close"
          >
            ✕
          </button>

          {/* Header Badge */}
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400 text-[8px] font-black uppercase tracking-widest mb-2 shadow-sm">
            <Flame size={12} className="animate-pulse" />
            <span>DAILY LOGIN REWARDS</span>
            <span>•</span>
            <span>STREAK: {profile.dailyStreak || 0} DAYS</span>
          </div>

          <h2 className="text-2xl md:text-3xl font-black uppercase tracking-tight text-white mb-1">
            CLAIM YOUR REWARD
          </h2>

          <p className="text-xs text-white/60 mb-5 max-w-sm mx-auto leading-relaxed">
            Log in every day to claim progressively higher coins, coupon scraps, and the Day 7 Crate Coupon Grand Prize!
          </p>

          {/* 7-Day Rewards Grid */}
          <div className="grid grid-cols-4 sm:grid-cols-7 gap-2 mb-6">
            {DAILY_LOGIN_REWARDS.map((item) => {
              const isClaimed = !status.canClaimToday 
                ? item.day <= status.activeDay 
                : item.day < status.activeDay;

              const isCurrent = status.canClaimToday && item.day === status.activeDay;
              const isLocked = !isClaimed && !isCurrent;

              return (
                <div
                  key={item.day}
                  className={`relative rounded-2xl p-2.5 flex flex-col items-center justify-between border transition-all ${
                    isCurrent
                      ? 'border-amber-400 bg-gradient-to-b from-amber-500/30 via-orange-950/40 to-black/80 shadow-[0_0_20px_rgba(245,158,11,0.5)] scale-105 z-10 animate-pulse'
                      : isClaimed
                        ? 'border-emerald-500/40 bg-emerald-950/20 text-emerald-300 opacity-85'
                        : item.isGrandPrize
                          ? 'border-purple-500/40 bg-purple-950/20 text-purple-300'
                          : 'border-white/10 bg-white/5 opacity-65'
                  }`}
                >
                  {/* Day Label */}
                  <div className={`text-[7.5px] font-black uppercase tracking-wider ${
                    isCurrent ? 'text-amber-300' : isClaimed ? 'text-emerald-400' : 'text-white/40'
                  }`}>
                    Day {item.day}
                  </div>

                  {/* Icon */}
                  <div className="my-1.5 flex items-center justify-center">
                    {isClaimed ? (
                      <div className="w-7 h-7 rounded-full bg-emerald-500/20 border border-emerald-400/50 flex items-center justify-center text-emerald-300">
                        <Check size={14} strokeWidth={3} />
                      </div>
                    ) : item.isGrandPrize ? (
                      <span className="text-2xl filter drop-shadow-[0_0_8px_rgba(217,70,239,0.8)]">
                        👑
                      </span>
                    ) : (
                      <span className="text-xl">
                        {item.scraps ? '🎟️' : '🪙'}
                      </span>
                    )}
                  </div>

                  {/* Rewards Breakdown */}
                  <div className="text-center w-full">
                    <div className={`text-[9px] font-black leading-tight ${
                      isCurrent ? 'text-amber-200' : 'text-white'
                    }`}>
                      +{item.coins}
                    </div>
                    {item.scraps && (
                      <div className="text-[6.5px] font-bold text-amber-300 leading-tight">
                        +{item.scraps} Scrap
                      </div>
                    )}
                    {item.coupons && (
                      <div className="text-[6.5px] font-black text-purple-300 leading-tight">
                        +1 Coupon
                      </div>
                    )}
                  </div>

                  {/* Top-Right Grand Prize Tag */}
                  {item.isGrandPrize && !isClaimed && (
                    <div className="absolute -top-1.5 -right-1 px-1 py-0.2 rounded bg-amber-400 text-black text-[5.5px] font-black uppercase shadow">
                      GRAND
                    </div>
                  )}

                  {/* Locked indicator */}
                  {isLocked && !item.isGrandPrize && (
                    <div className="absolute bottom-1 right-1 opacity-30">
                      <Lock size={9} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Action Button */}
          {status.canClaimToday ? (
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              disabled={isClaiming}
              onClick={handleClaim}
              className="w-full py-4 rounded-2xl bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 hover:from-amber-400 hover:to-orange-400 text-black font-black uppercase text-xs tracking-wider shadow-[0_0_30px_rgba(245,158,11,0.5)] transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <Sparkles size={16} />
              <span>CLAIM DAY {status.activeDay} BONUS (+{DAILY_LOGIN_REWARDS[status.activeDay - 1].coins} COINS)</span>
            </motion.button>
          ) : (
            <div className="p-4 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-between">
              <div className="text-left">
                <div className="text-xs font-black uppercase text-emerald-400 flex items-center gap-1.5">
                  <Check size={14} />
                  <span>Today's Bonus Claimed!</span>
                </div>
                <div className="text-[8px] text-white/50 mt-0.5">
                  Come back tomorrow for Day {((status.activeDay % 7) + 1)} (+{DAILY_LOGIN_REWARDS[(status.activeDay % 7)].coins} Coins)!
                </div>
              </div>

              <button
                onClick={onClose}
                className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer"
              >
                Got It
              </button>
            </div>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

export default DailyLoginBonusModal;
