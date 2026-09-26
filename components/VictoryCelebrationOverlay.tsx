import React, { useEffect } from 'react';
import { motion } from 'motion/react';
import confetti from 'canvas-confetti';
import { triggerVictoryConfetti, stopVictoryConfetti } from '../confettiCelebration';
import { soundEffects } from '../soundEffects';

interface VictoryCelebrationOverlayProps {
  coinsWon: number;
  xpWon: number;
}

const CELEBRATION_PARTICLES = [
  { icon: '👑', x: '10%', delay: 0, duration: 4.2 },
  { icon: '🪙', x: '22%', delay: 0.8, duration: 3.8 },
  { icon: '⭐', x: '35%', delay: 0.3, duration: 4.5 },
  { icon: '♠️', x: '48%', delay: 1.2, duration: 3.5 },
  { icon: '♥️', x: '62%', delay: 0.5, duration: 4.0 },
  { icon: '♦️', x: '75%', delay: 1.5, duration: 3.9 },
  { icon: '♣️', x: '88%', delay: 0.2, duration: 4.3 },
  { icon: '🪙', x: '15%', delay: 2.1, duration: 3.6 },
  { icon: '⭐', x: '82%', delay: 2.4, duration: 4.1 },
];

export const VictoryCelebrationOverlay: React.FC<VictoryCelebrationOverlayProps> = ({
  coinsWon,
  xpWon,
}) => {
  useEffect(() => {
    // 1. Trigger the sustained celebratory confetti cannons
    triggerVictoryConfetti();

    // 2. Play acoustic victory fanfare + coin reward sound
    soundEffects.playVictoryFanfare();
    setTimeout(() => {
      soundEffects.playCoinClink();
    }, 450);

    return () => {
      stopVictoryConfetti();
    };
  }, []);

  // Extra tactile feature: clicking anywhere on the victory screen shoots an interactive confetti burst
  const handleScreenClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const x = e.clientX / window.innerWidth;
    const y = e.clientY / window.innerHeight;
    confetti({
      particleCount: 35,
      spread: 70,
      origin: { x, y },
      colors: ['#ffd700', '#f59e0b', '#10b981', '#ffffff', '#ec4899'],
      zIndex: 10000,
      gravity: 1.1
    });
    soundEffects.playCard();
  };

  return (
    <div 
      onClick={handleScreenClick}
      className="absolute inset-0 pointer-events-auto overflow-hidden select-none z-0"
    >
      {/* 1. Radiant Rotating Golden Sunburst / Championship Aura */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-25">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ duration: 45, repeat: Infinity, ease: 'linear' }}
          className="w-[850px] h-[850px] md:w-[1200px] md:h-[1200px] rounded-full bg-[radial-gradient(circle,rgba(245,158,11,0.25)_0%,rgba(234,179,8,0.1)_35%,transparent_70%)]"
        />
      </div>

      {/* 2. Top Championship Glow Bar */}
      <div className="absolute top-0 left-0 right-0 h-40 bg-gradient-to-b from-amber-500/15 via-amber-500/5 to-transparent pointer-events-none" />

      {/* 3. Floating celebratory symbols drifting upwards */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {CELEBRATION_PARTICLES.map((p, idx) => (
          <motion.div
            key={idx}
            initial={{ y: '105vh', opacity: 0, scale: 0.6, rotate: 0 }}
            animate={{ 
              y: '-10vh', 
              opacity: [0, 0.9, 0.9, 0],
              scale: [0.6, 1.2, 1, 0.8],
              rotate: [0, idx % 2 === 0 ? 45 : -45, idx % 2 === 0 ? 90 : -90]
            }}
            transition={{
              duration: p.duration,
              repeat: Infinity,
              delay: p.delay,
              ease: 'easeOut'
            }}
            style={{ left: p.x }}
            className="absolute text-2xl md:text-4xl filter drop-shadow-[0_0_12px_rgba(245,158,11,0.6)]"
          >
            {p.icon}
          </motion.div>
        ))}
      </div>

      {/* 4. Tap Anywhere to Burst Hint */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 pointer-events-none text-center">
        <span className="text-[8px] font-black uppercase tracking-[0.25em] text-amber-300/40 bg-amber-500/5 border border-amber-500/10 px-3 py-1 rounded-full animate-pulse">
          ✨ Tap screen for confetti
        </span>
      </div>
    </div>
  );
};

export default VictoryCelebrationOverlay;
