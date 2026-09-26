import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { UserProfile, EventAnnouncement } from '../types';
import CardComponent from './CardComponent';
import { soundEffects } from '../soundEffects';
import { triggerVictoryConfetti } from '../confettiCelebration';
import { Sparkles, Trophy, Gift, ArrowLeft, Flame, Zap, Shield, RefreshCw, Edit3, Check } from 'lucide-react';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { toast } from 'sonner';

interface EventsSectionProps {
  profile: UserProfile;
  setProfile: React.Dispatch<React.SetStateAction<UserProfile>>;
  syncProfileToCloud: (updatedProfile: UserProfile) => Promise<void>;
  onBack: () => void;
}

interface CrateReward {
  type: 'skin' | 'coins' | 'scraps';
  skinId?: 'inferno' | 'cyberpunk';
  name: string;
  amount?: number;
  rarity: 'Legendary' | 'Epic' | 'Rare' | 'Common';
  description: string;
  icon: string;
}

const DEFAULT_EVENT: EventAnnouncement = {
  id: 'current_event',
  title: 'SEASON 1: INFERNO & CYBER NEXUS',
  subtitle: 'LIMITED EDITION EVENT CRATE',
  badge: 'ACTIVE EVENT • 2% DROP RATE',
  description: 'Unbox exclusive Mythic Card Skins, forge free Crate Coupons with Scraps, and dominate the Court Piece arena with custom visual styles!',
  crateName: 'Cyber-Inferno Mystery Crate',
  crateCostCoins: 200,
  featuredSkins: [
    {
      id: 'inferno',
      name: 'Inferno Dragon',
      rarity: 'Legendary',
      description: 'Molten magma borders & volcanic embers forged in the dragon realm.',
      dropRate: '1.0%'
    },
    {
      id: 'cyberpunk',
      name: 'Cyber Nexus',
      rarity: 'Legendary',
      description: 'Futuristic iridescent cyan & electric magenta holographic grid.',
      dropRate: '1.0%'
    }
  ],
  active: true
};

export const EventsSection: React.FC<EventsSectionProps> = ({
  profile,
  setProfile,
  syncProfileToCloud,
  onBack
}) => {
  const [eventData, setEventData] = useState<EventAnnouncement>(DEFAULT_EVENT);
  const [isOpening, setIsOpening] = useState(false);
  const [openedReward, setOpenedReward] = useState<CrateReward | null>(null);
  const [showOddsModal, setShowOddsModal] = useState(false);
  const [showAdminEditModal, setShowAdminEditModal] = useState(false);
  const [editTitle, setEditTitle] = useState(eventData.title);
  const [editDescription, setEditDescription] = useState(eventData.description);
  const [editBadge, setEditBadge] = useState(eventData.badge);
  const [activeTab, setActiveTab] = useState<'crate' | 'skins' | 'crafting'>('crate');

  // Load live announcement from Firestore
  useEffect(() => {
    const fetchAnnouncement = async () => {
      try {
        const snap = await getDoc(doc(db, 'events', 'current_event'));
        if (snap.exists()) {
          const data = snap.data() as EventAnnouncement;
          setEventData({ ...DEFAULT_EVENT, ...data });
          setEditTitle(data.title || DEFAULT_EVENT.title);
          setEditDescription(data.description || DEFAULT_EVENT.description);
          setEditBadge(data.badge || DEFAULT_EVENT.badge);
        }
      } catch (err) {
        console.warn("Using default event announcement:", err);
      }
    };
    fetchAnnouncement();
  }, []);

  const saveAdminAnnouncement = async () => {
    try {
      const updated: EventAnnouncement = {
        ...eventData,
        title: editTitle,
        description: editDescription,
        badge: editBadge,
        updatedAt: serverTimestamp()
      };
      await setDoc(doc(db, 'events', 'current_event'), updated, { merge: true });
      setEventData(updated);
      setShowAdminEditModal(false);
      toast.success("Event announcement updated for all players!");
    } catch (err) {
      console.error("Save announcement error:", err);
      toast.error("Failed to save announcement.");
    }
  };

  /**
   * Crate Opening Logic with strictly 2% Card Skin Luck
   */
  const handleOpenCrate = async (useCoupon: boolean) => {
    if (isOpening) return;

    if (useCoupon) {
      if ((profile.coupons || 0) < 1) {
        toast.error("No Crate Coupons available! Craft one using 10 Scraps or open with coins.");
        return;
      }
    } else {
      if (profile.role !== 'admin' && profile.coins < eventData.crateCostCoins) {
        toast.error(`Not enough coins! Each opening requires ${eventData.crateCostCoins} coins.`);
        return;
      }
    }

    setIsOpening(true);
    soundEffects.playShuffle();

    // Deduct cost
    let updatedProfile = { ...profile };
    if (useCoupon) {
      updatedProfile.coupons = Math.max(0, (profile.coupons || 0) - 1);
    } else if (profile.role !== 'admin') {
      updatedProfile.coins = Math.max(0, profile.coins - eventData.crateCostCoins);
    }

    // Determine drop outcome:
    // Strictly 2% chance for card skin (rng < 0.02)
    const rng = Math.random();
    let reward: CrateReward;

    if (rng < 0.02) {
      // 2% Card Skin Luck! (1% inferno, 1% cyberpunk)
      const isInferno = Math.random() < 0.5;
      const skinId: 'inferno' | 'cyberpunk' = isInferno ? 'inferno' : 'cyberpunk';
      const skinName = isInferno ? 'Inferno Dragon Skin' : 'Cyber Nexus Skin';

      // Check if already owned
      const alreadyOwned = updatedProfile.skins?.includes(skinId);

      if (alreadyOwned) {
        // Generous duplicate compensation: 500 Coins + 5 Scraps
        reward = {
          type: 'skin',
          skinId,
          name: `${skinName} (Duplicate)`,
          amount: 500,
          rarity: 'Legendary',
          description: 'You already own this skin! Converted to 500 Bonus Coins & 5 Coupon Scraps!',
          icon: isInferno ? '🔥' : '⚡'
        };
        updatedProfile.coins += 500;
        updatedProfile.scraps = (updatedProfile.scraps || 0) + 5;
      } else {
        reward = {
          type: 'skin',
          skinId,
          name: skinName,
          rarity: 'Legendary',
          description: isInferno 
            ? 'Molten obsidian & dragon flames visual style unlocked!'
            : 'Holographic cyber grid visual style unlocked!',
          icon: isInferno ? '🔥' : '⚡'
        };
        const currentSkins = updatedProfile.skins || ['classic'];
        updatedProfile.skins = [...currentSkins, skinId];
        updatedProfile.activeSkin = skinId; // Auto-equip newly unboxed legendary skin!
      }
    } else if (rng < 0.50) {
      // 48% chance: Coupon Scraps
      const scrapRoll = Math.random();
      let scrapsWon = 1;
      let rarity: 'Common' | 'Rare' | 'Epic' = 'Common';
      if (scrapRoll < 0.10) {
        scrapsWon = 5; // 5 scraps jackpot
        rarity = 'Epic';
      } else if (scrapRoll < 0.35) {
        scrapsWon = 3;
        rarity = 'Rare';
      } else if (scrapRoll < 0.65) {
        scrapsWon = 2;
      } else {
        scrapsWon = 1;
      }

      reward = {
        type: 'scraps',
        amount: scrapsWon,
        name: `${scrapsWon} Coupon Scrap${scrapsWon > 1 ? 's' : ''}`,
        rarity,
        description: 'Collect 10 scraps to forge 1 free Crate Opening Coupon!',
        icon: '🎟️'
      };
      updatedProfile.scraps = (updatedProfile.scraps || 0) + scrapsWon;
    } else {
      // 50% chance: Bonus Coins
      const coinRoll = Math.random();
      let coinsWon = 100;
      let rarity: 'Common' | 'Rare' | 'Epic' = 'Common';
      if (coinRoll < 0.05) {
        coinsWon = 1000; // Mega coin jackpot!
        rarity = 'Epic';
      } else if (coinRoll < 0.20) {
        coinsWon = 500;
        rarity = 'Rare';
      } else if (coinRoll < 0.50) {
        coinsWon = 250;
        rarity = 'Rare';
      } else {
        coinsWon = 100;
      }

      reward = {
        type: 'coins',
        amount: coinsWon,
        name: `${coinsWon} Coins`,
        rarity,
        description: 'Instant bonus coins added to your player balance!',
        icon: '🪙'
      };
      updatedProfile.coins += coinsWon;
    }

    // Unboxing animation delay
    setTimeout(async () => {
      setIsOpening(false);
      setOpenedReward(reward);
      setProfile(updatedProfile);
      syncProfileToCloud(updatedProfile).catch(console.warn);

      if (reward.type === 'skin') {
        triggerVictoryConfetti();
        soundEffects.playVictoryFanfare();
        toast.success(`🎉 LEGENDARY DROP! You unlocked ${reward.name}!`, { duration: 6000 });
      } else if (reward.type === 'coins') {
        soundEffects.playCoinClink();
        toast.success(`Won ${reward.name}!`);
      } else {
        soundEffects.playCard();
        toast.info(`Obtained ${reward.name}!`);
      }
    }, 1200);
  };

  /**
   * Crafting: 10 Scraps -> 1 Crate Coupon
   */
  const handleCraftCoupon = async () => {
    const currentScraps = profile.scraps || 0;
    if (currentScraps < 10) {
      toast.error(`You need 10 Scraps to craft a Coupon (Current: ${currentScraps}/10)`);
      return;
    }

    const updatedProfile: UserProfile = {
      ...profile,
      scraps: currentScraps - 10,
      coupons: (profile.coupons || 0) + 1
    };

    setProfile(updatedProfile);
    await syncProfileToCloud(updatedProfile);
    soundEffects.playCoinClink();
    toast.success("🎟️ 1 Crate Coupon forged successfully! Use it to open a crate for free.");
  };

  /**
   * Equip a Card Skin
   */
  const handleEquipSkin = async (skinId: 'classic' | 'neon' | 'gold' | 'void' | 'inferno' | 'cyberpunk') => {
    const owned = profile.skins?.includes(skinId) || skinId === 'classic';
    if (!owned) {
      toast.error("You don't own this skin yet. Unbox it from the Event Crate!");
      return;
    }

    const updatedProfile: UserProfile = {
      ...profile,
      activeSkin: skinId
    };

    setProfile(updatedProfile);
    await syncProfileToCloud(updatedProfile);
    soundEffects.playCard();
    toast.success(`Equipped ${skinId.toUpperCase()} card skin!`);
  };

  const currentScraps = profile.scraps || 0;
  const currentCoupons = profile.coupons || 0;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-[#060814] z-[250] flex flex-col items-center overflow-y-auto p-4 md:p-8 select-none"
    >
      {/* Background ambient lighting */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[350px] bg-gradient-to-b from-orange-500/10 via-purple-500/5 to-transparent blur-[120px] pointer-events-none" />

      {/* Top Header Navigation */}
      <div className="w-full max-w-4xl flex items-center justify-between mb-6 z-10">
        <button
          onClick={onBack}
          className="glass-panel px-4 py-2 rounded-2xl flex items-center gap-2 text-white/70 hover:text-white hover:border-white/30 transition-all text-xs font-black uppercase tracking-wider"
        >
          <ArrowLeft size={16} />
          <span>Lobby</span>
        </button>

        <div className="flex items-center gap-3">
          {/* Scraps Balance */}
          <div className="glass-panel px-3 py-1.5 rounded-xl border-amber-500/20 bg-amber-500/5 flex items-center gap-1.5 text-xs font-black text-amber-300">
            <span>🎟️</span>
            <span>{currentScraps} Scraps</span>
          </div>

          {/* Coupons Balance */}
          <div className="glass-panel px-3 py-1.5 rounded-xl border-emerald-500/20 bg-emerald-500/5 flex items-center gap-1.5 text-xs font-black text-emerald-300">
            <span>🎫</span>
            <span>{currentCoupons} Coupons</span>
          </div>

          {/* Coins Balance */}
          <div className="glass-panel px-3 py-1.5 rounded-xl border-yellow-500/20 bg-yellow-500/5 flex items-center gap-1.5 text-xs font-black text-yellow-300">
            <span>🪙</span>
            <span>{profile.role === 'admin' ? '∞' : profile.coins.toLocaleString()}</span>
          </div>

          {profile.role === 'admin' && (
            <button
              onClick={() => setShowAdminEditModal(true)}
              className="px-3 py-1.5 rounded-xl bg-indigo-600/30 border border-indigo-400/40 text-[10px] font-black uppercase text-indigo-300 hover:text-white transition-all flex items-center gap-1"
              title="Admin: Edit Announcement"
            >
              <Edit3 size={12} />
              <span>Edit Event</span>
            </button>
          )}
        </div>
      </div>

      {/* Event Announcement Hero Banner */}
      <div className="w-full max-w-4xl glass-panel p-6 md:p-8 rounded-[2.5rem] border border-orange-500/30 bg-gradient-to-r from-orange-950/30 via-slate-900/60 to-purple-950/30 shadow-[0_0_50px_rgba(249,115,22,0.15)] relative overflow-hidden mb-8 z-10 text-center md:text-left flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="relative z-10 flex-1">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-500/15 border border-orange-500/30 text-orange-400 text-[9px] font-black uppercase tracking-widest mb-3 animate-pulse">
            <Flame size={12} />
            <span>{eventData.badge}</span>
          </div>
          <h1 className="text-2xl md:text-4xl font-black uppercase tracking-tight text-white mb-2">
            {eventData.title}
          </h1>
          <p className="text-xs md:text-sm text-white/60 leading-relaxed max-w-xl">
            {eventData.description}
          </p>
        </div>

        {/* Drop Rate Highlight Badge */}
        <div className="flex flex-col items-center md:items-end gap-2 shrink-0">
          <div className="glass-panel p-4 rounded-2xl border-orange-500/30 bg-black/40 text-center">
            <div className="text-[8px] font-black text-white/40 uppercase tracking-widest">Card Skins Luck</div>
            <div className="text-3xl font-black text-amber-400 tracking-tight">2.0%</div>
            <div className="text-[7.5px] font-mono text-emerald-400 uppercase mt-0.5">Legendary Tier</div>
          </div>
          <button
            onClick={() => setShowOddsModal(true)}
            className="text-[9px] font-black text-white/40 hover:text-white uppercase tracking-wider underline cursor-pointer"
          >
            View Drop Probabilities ℹ️
          </button>
        </div>
      </div>

      {/* Category Tabs */}
      <div className="w-full max-w-4xl flex items-center justify-center gap-2 mb-8 z-10">
        <button
          onClick={() => setActiveTab('crate')}
          className={`px-6 py-3 rounded-2xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-2 ${
            activeTab === 'crate'
              ? 'bg-gradient-to-r from-orange-600 to-amber-600 text-white shadow-[0_0_20px_rgba(249,115,22,0.4)] scale-105'
              : 'glass-panel text-white/50 hover:text-white'
          }`}
        >
          <Gift size={15} />
          <span>Open Crates</span>
        </button>

        <button
          onClick={() => setActiveTab('skins')}
          className={`px-6 py-3 rounded-2xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-2 ${
            activeTab === 'skins'
              ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-[0_0_20px_rgba(147,51,234,0.4)] scale-105'
              : 'glass-panel text-white/50 hover:text-white'
          }`}
        >
          <Sparkles size={15} />
          <span>Card Skins Vault</span>
        </button>

        <button
          onClick={() => setActiveTab('crafting')}
          className={`px-6 py-3 rounded-2xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-2 ${
            activeTab === 'crafting'
              ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-[0_0_20px_rgba(16,185,129,0.4)] scale-105'
              : 'glass-panel text-white/50 hover:text-white'
          }`}
        >
          <span>🎟️ Coupon Workshop</span>
        </button>
      </div>

      {/* TAB 1: Crate Opening Area */}
      {activeTab === 'crate' && (
        <div className="w-full max-w-4xl flex flex-col items-center z-10">
          <div className="w-full max-w-md glass-panel p-8 rounded-[3rem] border border-orange-500/40 bg-black/60 shadow-[0_20px_50px_rgba(0,0,0,0.8)] text-center relative overflow-hidden">
            {/* Ambient Crate Core Aura */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 bg-gradient-to-tr from-orange-500/20 via-amber-500/10 to-transparent rounded-full blur-[50px] pointer-events-none" />

            <div className="mb-2 text-[9px] font-black uppercase tracking-widest text-orange-400">
              {eventData.crateName}
            </div>
            <h2 className="text-2xl font-black uppercase tracking-tight text-white mb-6">
              CYBER-INFERNO CRATE
            </h2>

            {/* Animated Crate Icon */}
            <motion.div
              animate={isOpening ? {
                rotate: [-8, 8, -6, 6, -3, 3, 0],
                scale: [1, 1.15, 1.05, 1.2, 1],
                filter: [
                  'drop-shadow(0 0 15px rgba(249,115,22,0.4))',
                  'drop-shadow(0 0 40px rgba(249,115,22,0.9))',
                  'drop-shadow(0 0 20px rgba(249,115,22,0.6))'
                ]
              } : {
                y: [0, -8, 0],
                filter: 'drop-shadow(0 0 20px rgba(249,115,22,0.3))'
              }}
              transition={isOpening ? { duration: 1.2, ease: 'easeInOut' } : { duration: 3, repeat: Infinity, ease: 'easeInOut' }}
              className="w-36 h-36 mx-auto mb-8 relative flex items-center justify-center cursor-pointer select-none"
              onClick={() => handleOpenCrate(currentCoupons > 0)}
            >
              <div className="w-32 h-32 rounded-3xl bg-gradient-to-br from-amber-600 via-orange-700 to-purple-900 border-2 border-orange-400/60 flex items-center justify-center text-6xl shadow-2xl relative overflow-hidden group">
                <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-white/20" />
                <span className="relative z-10 transform group-hover:scale-110 transition-transform">
                  🎁
                </span>
                <div className="absolute inset-0 border-2 border-dashed border-white/20 rounded-2xl m-1" />
              </div>
            </motion.div>

            {/* Quick Odds & Featured Preview */}
            <div className="grid grid-cols-2 gap-3 mb-8">
              <div className="p-3 rounded-2xl bg-white/5 border border-white/10 text-left">
                <div className="text-[8px] font-black uppercase tracking-wider text-orange-400">Featured Skin 1</div>
                <div className="text-xs font-black text-white mt-0.5">Inferno Dragon</div>
                <div className="text-[8px] font-mono text-white/40">1.0% Luck</div>
              </div>
              <div className="p-3 rounded-2xl bg-white/5 border border-white/10 text-left">
                <div className="text-[8px] font-black uppercase tracking-wider text-cyan-400">Featured Skin 2</div>
                <div className="text-xs font-black text-white mt-0.5">Cyber Nexus</div>
                <div className="text-[8px] font-mono text-white/40">1.0% Luck</div>
              </div>
            </div>

            {/* Opening Buttons */}
            <div className="space-y-3">
              {/* Option A: Open with Coins */}
              <button
                disabled={isOpening}
                onClick={() => handleOpenCrate(false)}
                className="w-full py-4 rounded-2xl bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 hover:from-amber-400 hover:to-orange-400 text-black font-black uppercase text-xs tracking-wider shadow-[0_0_25px_rgba(245,158,11,0.4)] active:scale-95 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {isOpening ? (
                  <RefreshCw className="animate-spin" size={16} />
                ) : (
                  <>
                    <span>OPEN FOR {eventData.crateCostCoins}</span>
                    <span>🪙</span>
                  </>
                )}
              </button>

              {/* Option B: Open with Free Coupon */}
              <button
                disabled={isOpening || currentCoupons < 1}
                onClick={() => handleOpenCrate(true)}
                className={`w-full py-3.5 rounded-2xl border font-black uppercase text-xs tracking-wider transition-all flex items-center justify-center gap-2 ${
                  currentCoupons >= 1
                    ? 'bg-emerald-600/20 border-emerald-500/50 text-emerald-300 hover:bg-emerald-600/30 hover:shadow-[0_0_20px_rgba(16,185,129,0.3)] active:scale-95 cursor-pointer'
                    : 'bg-white/5 border-white/5 text-white/30 cursor-not-allowed'
                }`}
              >
                <span>USE 1 CRATE COUPON</span>
                <span>🎟️</span>
                <span className="text-[9px] opacity-75">({currentCoupons} Owned)</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: Card Skins Showcase & Equipper */}
      {activeTab === 'skins' && (
        <div className="w-full max-w-4xl z-10">
          <div className="text-center mb-6">
            <h2 className="text-2xl font-black uppercase tracking-tight text-white">CARD SKINS VAULT</h2>
            <p className="text-xs text-white/50">Equip your owned visual styles or preview exclusive event crate drops.</p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 md:gap-6">
            {[
              { id: 'inferno' as const, name: 'Inferno Dragon', rarity: 'Legendary', tag: '2% Event Crate', isNew: true },
              { id: 'cyberpunk' as const, name: 'Cyber Nexus', rarity: 'Legendary', tag: '2% Event Crate', isNew: true },
              { id: 'gold' as const, name: 'Royal Gold', rarity: 'Epic', tag: 'VIP Style' },
              { id: 'void' as const, name: 'Cosmic Void', rarity: 'Rare', tag: 'Shadow Realm' },
              { id: 'neon' as const, name: 'Electric Neon', rarity: 'Uncommon', tag: 'Cyber Series' },
              { id: 'classic' as const, name: 'Grand Classic', rarity: 'Standard', tag: 'Default Skin' },
            ].map(skin => {
              const isOwned = profile.skins?.includes(skin.id) || skin.id === 'classic';
              const isEquipped = profile.activeSkin === skin.id;

              return (
                <div
                  key={skin.id}
                  className={`glass-panel p-5 rounded-3xl border flex flex-col items-center text-center relative overflow-hidden transition-all ${
                    isEquipped
                      ? 'border-emerald-500/60 bg-emerald-950/20 shadow-[0_0_25px_rgba(16,185,129,0.2)]'
                      : isOwned
                        ? 'border-white/20 hover:border-white/40'
                        : 'border-white/5 opacity-75 hover:opacity-100'
                  }`}
                >
                  {skin.isNew && (
                    <span className="absolute top-3 left-3 px-2 py-0.5 rounded-full bg-orange-500/20 border border-orange-500/40 text-orange-300 text-[7px] font-black uppercase tracking-wider">
                      NEW CRATE
                    </span>
                  )}

                  <span className={`absolute top-3 right-3 text-[8px] font-black uppercase tracking-wider ${
                    skin.rarity === 'Legendary' ? 'text-amber-400' : skin.rarity === 'Epic' ? 'text-purple-400' : 'text-white/40'
                  }`}>
                    {skin.rarity}
                  </span>

                  {/* Card Preview */}
                  <div className="my-4 pointer-events-none transform hover:scale-105 transition-transform">
                    <CardComponent
                      card={{ suit: 'spades', rank: 'A', value: 14 }}
                      skin={skin.id}
                      className="scale-90"
                    />
                  </div>

                  <h3 className="text-sm font-black uppercase text-white mb-1">{skin.name}</h3>
                  <div className="text-[8px] font-mono text-white/40 mb-4">{skin.tag}</div>

                  {/* Action Button */}
                  {isEquipped ? (
                    <div className="w-full py-2.5 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[10px] font-black uppercase flex items-center justify-center gap-1.5">
                      <Check size={12} />
                      <span>EQUIPPED</span>
                    </div>
                  ) : isOwned ? (
                    <button
                      onClick={() => handleEquipSkin(skin.id)}
                      className="w-full py-2.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-white text-[10px] font-black uppercase transition-all cursor-pointer"
                    >
                      EQUIP SKIN
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        setActiveTab('crate');
                        toast.info("Unbox this exclusive skin from the Cyber-Inferno Crate!");
                      }}
                      className="w-full py-2.5 rounded-xl bg-orange-500/10 border border-orange-500/20 text-orange-400 hover:bg-orange-500/20 text-[10px] font-black uppercase transition-all cursor-pointer"
                    >
                      GET IN CRATE
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 3: Coupon Crafting Workshop */}
      {activeTab === 'crafting' && (
        <div className="w-full max-w-xl z-10">
          <div className="glass-panel p-8 rounded-[2.5rem] border border-emerald-500/30 bg-black/60 shadow-[0_20px_50px_rgba(0,0,0,0.8)] text-center">
            <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-3xl mx-auto mb-4 animate-pulse">
              🎟️
            </div>

            <h2 className="text-2xl font-black uppercase tracking-tight text-white mb-2">
              COUPON FORGE
            </h2>
            <p className="text-xs text-white/50 leading-relaxed mb-6">
              Combine your collected Coupon Scraps into full Crate Coupons. Every 10 Scraps yields 1 Free Crate Opening Coupon!
            </p>

            {/* Scrap Progress Bar */}
            <div className="p-5 rounded-2xl bg-white/5 border border-white/10 mb-6">
              <div className="flex items-center justify-between text-xs font-black uppercase mb-2">
                <span className="text-white/60">Scrap Progress</span>
                <span className="text-amber-400">{currentScraps} / 10 Scraps</span>
              </div>
              <div className="h-3 w-full bg-black/60 rounded-full overflow-hidden border border-white/5 p-0.5">
                <div
                  className="h-full bg-gradient-to-r from-amber-500 to-emerald-500 rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(100, (currentScraps / 10) * 100)}%` }}
                />
              </div>
              <div className="mt-2 text-[9px] text-white/40 text-left">
                {currentScraps >= 10
                  ? `✨ Ready to craft! You have enough scraps for ${Math.floor(currentScraps / 10)} Coupon(s)!`
                  : `Need ${10 - (currentScraps % 10)} more scraps for your next Coupon.`}
              </div>
            </div>

            {/* Current Inventory Summary */}
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="p-4 rounded-2xl bg-amber-500/5 border border-amber-500/20 text-center">
                <div className="text-[8px] font-black text-amber-400 uppercase">Available Scraps</div>
                <div className="text-2xl font-black text-amber-300 mt-1">{currentScraps}</div>
              </div>
              <div className="p-4 rounded-2xl bg-emerald-500/5 border border-emerald-500/20 text-center">
                <div className="text-[8px] font-black text-emerald-400 uppercase">Crafted Coupons</div>
                <div className="text-2xl font-black text-emerald-300 mt-1">{currentCoupons}</div>
              </div>
            </div>

            {/* Craft Action Button */}
            <button
              disabled={currentScraps < 10}
              onClick={handleCraftCoupon}
              className={`w-full py-4 rounded-2xl font-black uppercase text-xs tracking-wider transition-all flex items-center justify-center gap-2 ${
                currentScraps >= 10
                  ? 'bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-black shadow-[0_0_25px_rgba(16,185,129,0.4)] active:scale-95 cursor-pointer'
                  : 'bg-white/5 border border-white/5 text-white/30 cursor-not-allowed'
              }`}
            >
              <span>FORGE 1 COUPON (COST: 10 SCRAPS)</span>
              <span>🔨</span>
            </button>
          </div>
        </div>
      )}

      {/* MODAL: Reward Reveal */}
      <AnimatePresence>
        {openedReward && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 flex items-center justify-center z-[500] p-4 bg-black/90 backdrop-blur-md"
          >
            <motion.div
              initial={{ scale: 0.8, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.8, opacity: 0, y: 20 }}
              className={`relative w-full max-w-sm glass-panel p-8 rounded-[2.5rem] border-2 text-center shadow-[0_0_60px_rgba(0,0,0,0.9)] ${
                openedReward.rarity === 'Legendary'
                  ? 'border-amber-500/80 bg-amber-950/40 shadow-[0_0_50px_rgba(245,158,11,0.3)]'
                  : openedReward.rarity === 'Epic'
                    ? 'border-purple-500/60 bg-purple-950/30'
                    : 'border-white/20 bg-black/90'
              }`}
            >
              <div className="text-5xl mb-3 animate-bounce">
                {openedReward.icon}
              </div>

              <div className={`inline-block px-3 py-1 rounded-full text-[8px] font-black uppercase tracking-widest mb-2 ${
                openedReward.rarity === 'Legendary'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                  : openedReward.rarity === 'Epic'
                    ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
                    : 'bg-white/10 text-white/60 border border-white/10'
              }`}>
                {openedReward.rarity} REWARD
              </div>

              <h3 className="text-2xl font-black uppercase text-white mb-2">
                {openedReward.name}
              </h3>

              <p className="text-xs text-white/60 mb-6 leading-relaxed px-2">
                {openedReward.description}
              </p>

              {/* Skin Card Preview if Legendary */}
              {openedReward.skinId && (
                <div className="flex justify-center mb-6">
                  <CardComponent
                    card={{ suit: 'hearts', rank: 'A', value: 14 }}
                    skin={openedReward.skinId}
                    className="scale-100 shadow-[0_0_30px_rgba(249,115,22,0.4)]"
                  />
                </div>
              )}

              <button
                onClick={() => setOpenedReward(null)}
                className="w-full py-4 rounded-2xl bg-white text-black font-black uppercase text-xs tracking-wider hover:bg-white/90 active:scale-95 transition-all cursor-pointer shadow-lg"
              >
                CLAIM REWARD
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* MODAL: Drop Probabilities */}
      <AnimatePresence>
        {showOddsModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 flex items-center justify-center z-[500] p-4 bg-black/85 backdrop-blur-md"
            onClick={() => setShowOddsModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="relative w-full max-w-md glass-panel p-6 md:p-8 rounded-[2rem] border border-white/20 bg-black/95 text-left"
            >
              <h3 className="text-xl font-black uppercase text-white mb-1">CRATE DROP PROBABILITIES</h3>
              <p className="text-xs text-white/50 mb-6">Verified transparent luck distribution per crate opening.</p>

              <div className="space-y-3 mb-6">
                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-between">
                  <div>
                    <div className="text-xs font-black text-amber-300 uppercase">Card Skins (Legendary)</div>
                    <div className="text-[9px] text-white/50">Inferno Dragon (1%) & Cyber Nexus (1%)</div>
                  </div>
                  <div className="text-lg font-black text-amber-400">2.0%</div>
                </div>

                <div className="p-3 rounded-xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-between">
                  <div>
                    <div className="text-xs font-black text-purple-300 uppercase">Coupon Scraps (Crafting)</div>
                    <div className="text-[9px] text-white/50">1, 2, 3, or 5 Scraps (10 Scraps = 1 Free Coupon)</div>
                  </div>
                  <div className="text-lg font-black text-purple-400">48.0%</div>
                </div>

                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-between">
                  <div>
                    <div className="text-xs font-black text-emerald-300 uppercase">Bonus Coins</div>
                    <div className="text-[9px] text-white/50">100, 250, 500, or 1,000 Coins Jackpot</div>
                  </div>
                  <div className="text-lg font-black text-emerald-400">50.0%</div>
                </div>
              </div>

              <button
                onClick={() => setShowOddsModal(false)}
                className="w-full py-3.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-black uppercase text-xs tracking-wider transition-all"
              >
                GOT IT
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* MODAL: Admin Event Editor */}
      <AnimatePresence>
        {showAdminEditModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 flex items-center justify-center z-[500] p-4 bg-black/85 backdrop-blur-md"
            onClick={() => setShowAdminEditModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="relative w-full max-w-md glass-panel p-6 md:p-8 rounded-[2rem] border border-indigo-500/30 bg-black/95 text-left"
            >
              <h3 className="text-xl font-black uppercase text-indigo-400 mb-1">ADMIN: EVENT ANNOUNCEMENT</h3>
              <p className="text-xs text-white/50 mb-6">Update live event banner and description stored in Firestore.</p>

              <div className="space-y-4 mb-6">
                <div>
                  <label className="text-[9px] font-black uppercase text-white/40 block mb-1">Badge Tag</label>
                  <input
                    type="text"
                    value={editBadge}
                    onChange={e => setEditBadge(e.target.value)}
                    className="w-full p-3 rounded-xl bg-white/5 border border-white/10 text-white text-xs font-bold outline-none focus:border-indigo-400"
                  />
                </div>

                <div>
                  <label className="text-[9px] font-black uppercase text-white/40 block mb-1">Event Title</label>
                  <input
                    type="text"
                    value={editTitle}
                    onChange={e => setEditTitle(e.target.value)}
                    className="w-full p-3 rounded-xl bg-white/5 border border-white/10 text-white text-xs font-bold outline-none focus:border-indigo-400"
                  />
                </div>

                <div>
                  <label className="text-[9px] font-black uppercase text-white/40 block mb-1">Description</label>
                  <textarea
                    rows={3}
                    value={editDescription}
                    onChange={e => setEditDescription(e.target.value)}
                    className="w-full p-3 rounded-xl bg-white/5 border border-white/10 text-white text-xs font-bold outline-none focus:border-indigo-400 resize-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setShowAdminEditModal(false)}
                  className="py-3 rounded-xl bg-white/5 text-white/50 hover:bg-white/10 font-black uppercase text-xs"
                >
                  CANCEL
                </button>
                <button
                  onClick={saveAdminAnnouncement}
                  className="py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-black uppercase text-xs shadow-lg"
                >
                  SAVE & BROADCAST
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default EventsSection;
