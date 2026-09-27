import React from 'react';
import { Card, Suit } from '../types';

interface CardComponentProps {
  card?: Card;
  hidden?: boolean;
  onClick?: (e?: React.MouseEvent) => void;
  onTouchEnd?: (e?: React.TouchEvent) => void;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
  skin?: 'classic' | 'neon' | 'gold' | 'void' | 'inferno' | 'cyberpunk';
}

const suitIcons: Record<Suit, string> = {
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
  spades: '♠'
};

export const CardComponent: React.FC<CardComponentProps> = ({ 
  card, 
  hidden = false, 
  onClick, 
  onTouchEnd, 
  disabled = false, 
  className = "", 
  style, 
  skin = 'classic' 
}) => {
  const baseClasses = "w-[65px] h-[92px] md:w-[95px] md:h-[135px] rounded-xl border transition-all duration-200 overflow-hidden select-none relative group";

  // ==========================================
  // 1. HIDDEN / CARD BACK STYLING PER SKIN
  // ==========================================
  if (hidden) {
    if (skin === 'inferno') {
      return (
        <div 
          onClick={!disabled ? onClick : undefined}
          onTouchEnd={!disabled ? onTouchEnd : undefined}
          style={style}
          className={`${baseClasses} bg-[#120303] border-orange-600/80 shadow-[0_0_18px_rgba(234,88,12,0.4)] flex items-center justify-center p-1 ${className}`}
        >
          {/* Dragon Scale Magma Card Back */}
          <div className="w-full h-full rounded-lg border border-amber-500/40 relative overflow-hidden flex items-center justify-center bg-gradient-to-br from-[#2a0808] via-[#150303] to-[#3d0909]">
            {/* Magma fissure veins */}
            <div className="absolute inset-0 opacity-30 bg-[radial-gradient(#f97316_1px,transparent_1px)] [background-size:6px_6px]" />
            <svg className="absolute inset-0 w-full h-full opacity-20 pointer-events-none" viewBox="0 0 100 140" fill="none">
              <path d="M10 20 Q50 50 90 20 Q60 70 90 120 Q50 90 10 120 Q40 70 10 20Z" stroke="#f97316" strokeWidth="1.5" />
            </svg>
            {/* Dragon Crest Center Shield */}
            <div className="relative z-10 w-8 h-10 md:w-11 md:h-14 rounded-lg bg-gradient-to-b from-amber-500/20 via-orange-950/80 to-black border border-amber-400/60 flex items-center justify-center shadow-[0_0_15px_rgba(245,158,11,0.5)]">
              <span className="text-sm md:text-xl filter drop-shadow-[0_0_6px_#f97316]">🐉</span>
              <div className="absolute inset-0 border border-orange-500/30 rounded-md m-0.5" />
            </div>
            {/* Corner Gold Claws */}
            <div className="absolute top-1 left-1 text-[7px] text-amber-500/60 leading-none">✦</div>
            <div className="absolute top-1 right-1 text-[7px] text-amber-500/60 leading-none">✦</div>
            <div className="absolute bottom-1 left-1 text-[7px] text-amber-500/60 leading-none">✦</div>
            <div className="absolute bottom-1 right-1 text-[7px] text-amber-500/60 leading-none">✦</div>
          </div>
        </div>
      );
    }

    if (skin === 'cyberpunk') {
      return (
        <div 
          onClick={!disabled ? onClick : undefined}
          onTouchEnd={!disabled ? onTouchEnd : undefined}
          style={style}
          className={`${baseClasses} bg-[#040814] border-cyan-400/80 shadow-[0_0_18px_rgba(34,211,238,0.4)] flex items-center justify-center p-1 ${className}`}
        >
          {/* Cyber Nexus Circuit Processor Card Back */}
          <div className="w-full h-full rounded-lg border border-cyan-500/40 relative overflow-hidden flex items-center justify-center bg-gradient-to-br from-[#071329] via-[#040b18] to-[#0c1836]">
            {/* Tech grid overlay */}
            <div className="absolute inset-0 opacity-25 bg-[linear-gradient(to_right,#06b6d4_1px,transparent_1px),linear-gradient(to_bottom,#06b6d4_1px,transparent_1px)] [background-size:8px_8px]" />
            {/* Quantum Core */}
            <div className="relative z-10 w-8 h-10 md:w-11 md:h-14 rounded-lg bg-black/80 border border-cyan-400/70 flex flex-col items-center justify-center shadow-[0_0_15px_rgba(6,182,212,0.6)]">
              <span className="text-[10px] md:text-xs font-mono font-black text-fuchsia-400 tracking-tighter">NEXUS</span>
              <div className="w-4 h-4 md:w-6 md:h-6 rounded-full border border-cyan-300 flex items-center justify-center my-0.5 animate-pulse">
                <div className="w-1.5 h-1.5 md:w-2 md:h-2 rounded-full bg-cyan-400 shadow-[0_0_8px_#22d3ee]" />
              </div>
              <span className="text-[6px] md:text-[8px] font-mono text-cyan-400/80">SYS.01</span>
            </div>
            {/* Tech Bracket Notches */}
            <div className="absolute top-1 left-1.5 text-[7px] font-mono text-cyan-400/80 leading-none">⌜</div>
            <div className="absolute top-1 right-1.5 text-[7px] font-mono text-cyan-400/80 leading-none">⌝</div>
            <div className="absolute bottom-1 left-1.5 text-[7px] font-mono text-cyan-400/80 leading-none">⌞</div>
            <div className="absolute bottom-1 right-1.5 text-[7px] font-mono text-cyan-400/80 leading-none">⌟</div>
          </div>
        </div>
      );
    }

    if (skin === 'gold') {
      return (
        <div 
          onClick={!disabled ? onClick : undefined}
          onTouchEnd={!disabled ? onTouchEnd : undefined}
          style={style}
          className={`${baseClasses} bg-[#1a1405] border-yellow-500/80 shadow-[0_0_15px_rgba(234,179,8,0.3)] flex items-center justify-center p-1 ${className}`}
        >
          <div className="w-full h-full rounded-lg border-2 border-yellow-500/40 relative overflow-hidden flex items-center justify-center bg-gradient-to-br from-[#2a1f07] via-[#1a1303] to-[#3a2c0a]">
            <div className="w-8 h-10 md:w-11 md:h-14 rounded-full border border-yellow-400/50 flex items-center justify-center">
              <span className="text-sm md:text-xl">👑</span>
            </div>
          </div>
        </div>
      );
    }

    // Default / Void / Neon card back
    return (
      <div 
        onClick={!disabled ? onClick : undefined}
        onTouchEnd={!disabled ? onTouchEnd : undefined}
        style={style}
        className={`${baseClasses} bg-[#0f172a] border-[#1e293b] flex items-center justify-center p-1 ${className}`}
      >
        <div className="w-full h-full border border-indigo-500/20 rounded-lg flex items-center justify-center bg-gradient-to-br from-[#1e293b] to-[#0f172a]">
          <div className="w-7 h-7 md:w-9 md:h-9 rounded-full bg-indigo-500/10 border border-indigo-400/30 flex items-center justify-center animate-pulse">
            <span className="text-xs text-indigo-300">♠</span>
          </div>
        </div>
      </div>
    );
  }

  if (!card) return null;
  const isRed = card.suit === 'hearts' || card.suit === 'diamonds';

  // ==========================================
  // 2. INFERNO DRAGON (LEGENDARY SKIN)
  // ==========================================
  if (skin === 'inferno') {
    const textColor = isRed ? 'text-amber-400' : 'text-orange-500';
    const suitSymbol = suitIcons[card.suit];

    return (
      <div 
        onClick={!disabled ? onClick : undefined}
        onTouchEnd={!disabled ? onTouchEnd : undefined}
        style={style}
        className={`
          ${baseClasses}
          bg-[#120202] border-2 border-orange-500/90 shadow-[0_0_20px_rgba(249,115,22,0.45)]
          flex flex-col justify-between p-1.5 md:p-2.5 cursor-pointer
          ${disabled ? 'opacity-40 grayscale scale-95 cursor-not-allowed' : 'md:hover:-translate-y-2 md:hover:shadow-[0_0_25px_rgba(249,115,22,0.7)] active:scale-95'}
          ${className}
        `}
      >
        {/* Volcanic Magma Texture & Veins */}
        <div className="absolute inset-0 pointer-events-none bg-gradient-to-b from-[#2d0707] via-[#130303] to-[#360909]" />
        <div className="absolute inset-0 pointer-events-none opacity-30 bg-[radial-gradient(#ea580c_1px,transparent_1px)] [background-size:6px_6px]" />
        <div className="absolute -top-6 -left-6 w-16 h-16 bg-orange-500/20 rounded-full blur-xl pointer-events-none" />
        <div className="absolute -bottom-6 -right-6 w-16 h-16 bg-amber-500/20 rounded-full blur-xl pointer-events-none" />

        {/* Ornate Inner Metallic Gold Border */}
        <div className="absolute inset-1 rounded-lg border border-amber-500/40 pointer-events-none" />
        <div className="absolute inset-1.5 rounded-md border border-orange-500/20 pointer-events-none" />

        {/* Top-Left Index */}
        <div className={`relative z-10 flex flex-col items-start leading-none font-black ${textColor}`}>
          <div className="flex items-center gap-0.5">
            <span className="text-base md:text-2xl tracking-tighter filter drop-shadow-[0_0_4px_rgba(245,158,11,0.8)]">
              {card.rank}
            </span>
            {['A', 'K', 'Q', 'J'].includes(card.rank) && (
              <span className="text-[7px] md:text-[9px] text-amber-400">👑</span>
            )}
          </div>
          <span className="text-xs md:text-lg filter drop-shadow-[0_0_6px_rgba(249,115,22,0.9)]">
            {suitSymbol}
          </span>
        </div>

        {/* Central Flaming Dragon Crest & Suit Emblem */}
        <div className="relative z-10 self-center flex flex-col items-center justify-center my-auto pointer-events-none">
          {/* Dragon Silhouette Watermark */}
          <div className="relative flex items-center justify-center">
            <div className="absolute w-12 h-12 md:w-16 md:h-16 rounded-full bg-gradient-to-tr from-orange-600/20 to-amber-500/10 blur-sm animate-pulse" />
            <svg className="w-10 h-10 md:w-16 md:h-16 text-orange-500/35 filter drop-shadow-[0_0_10px_rgba(249,115,22,0.5)]" viewBox="0 0 100 100" fill="currentColor">
              {/* Stylized Dragon Wings / Wyrm Crest */}
              <path d="M50 15 C35 25, 20 20, 15 35 C10 50, 25 60, 30 70 C35 80, 50 90, 50 90 C50 90, 65 80, 70 70 C75 60, 90 50, 85 35 C80 20, 65 25, 50 15 Z" fillOpacity="0.25" stroke="#f97316" strokeWidth="2" />
              <path d="M50 30 Q40 45 35 60 Q50 55 65 60 Q60 45 50 30Z" fill="#ea580c" fillOpacity="0.3" />
            </svg>
            <span className={`absolute text-2xl md:text-4xl font-black ${textColor} filter drop-shadow-[0_0_8px_rgba(245,158,11,0.9)]`}>
              {suitSymbol}
            </span>
          </div>
        </div>

        {/* Bottom-Right Inverted Index */}
        <div className={`relative z-10 flex flex-col items-end leading-none font-black rotate-180 ${textColor}`}>
          <div className="flex items-center gap-0.5">
            <span className="text-base md:text-2xl tracking-tighter filter drop-shadow-[0_0_4px_rgba(245,158,11,0.8)]">
              {card.rank}
            </span>
            {['A', 'K', 'Q', 'J'].includes(card.rank) && (
              <span className="text-[7px] md:text-[9px] text-amber-400">👑</span>
            )}
          </div>
          <span className="text-xs md:text-lg filter drop-shadow-[0_0_6px_rgba(249,115,22,0.9)]">
            {suitSymbol}
          </span>
        </div>
      </div>
    );
  }

  // ==========================================
  // 3. CYBER NEXUS (LEGENDARY SKIN)
  // ==========================================
  if (skin === 'cyberpunk') {
    const textColor = isRed ? 'text-fuchsia-400' : 'text-cyan-300';
    const suitSymbol = suitIcons[card.suit];

    return (
      <div 
        onClick={!disabled ? onClick : undefined}
        onTouchEnd={!disabled ? onTouchEnd : undefined}
        style={style}
        className={`
          ${baseClasses}
          bg-[#030712] border-2 border-cyan-400/90 shadow-[0_0_20px_rgba(34,211,238,0.45)]
          flex flex-col justify-between p-1.5 md:p-2.5 cursor-pointer
          ${disabled ? 'opacity-40 grayscale scale-95 cursor-not-allowed' : 'md:hover:-translate-y-2 md:hover:shadow-[0_0_25px_rgba(34,211,238,0.7)] active:scale-95'}
          ${className}
        `}
      >
        {/* Cyber Hologram Grid & Scanline */}
        <div className="absolute inset-0 pointer-events-none bg-gradient-to-b from-[#06152d] via-[#040816] to-[#160626]" />
        <div className="absolute inset-0 pointer-events-none opacity-20 bg-[linear-gradient(to_right,#06b6d4_1px,transparent_1px),linear-gradient(to_bottom,#06b6d4_1px,transparent_1px)] [background-size:8px_8px]" />
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-cyan-400 to-transparent animate-pulse" />

        {/* Tech Corner Brackets */}
        <div className="absolute top-1 left-1.5 text-[8px] font-mono text-cyan-400/80 leading-none">⌜</div>
        <div className="absolute top-1 right-1.5 text-[8px] font-mono text-fuchsia-400/80 leading-none">⌝</div>
        <div className="absolute bottom-1 left-1.5 text-[8px] font-mono text-fuchsia-400/80 leading-none">⌞</div>
        <div className="absolute bottom-1 right-1.5 text-[8px] font-mono text-cyan-400/80 leading-none">⌟</div>

        {/* Top-Left Index */}
        <div className={`relative z-10 flex flex-col items-start leading-none font-mono font-black ${textColor}`}>
          <div className="flex items-center gap-0.5">
            <span className="text-base md:text-2xl tracking-tighter filter drop-shadow-[0_0_6px_rgba(34,211,238,0.8)]">
              {card.rank}
            </span>
          </div>
          <span className="text-xs md:text-lg filter drop-shadow-[0_0_8px_rgba(217,70,239,0.9)]">
            {suitSymbol}
          </span>
          <span className="text-[5.5px] md:text-[6.5px] font-mono text-cyan-400/60 uppercase tracking-widest mt-0.5">
            SYS:A7
          </span>
        </div>

        {/* Central Quantum HUD Matrix */}
        <div className="relative z-10 self-center flex flex-col items-center justify-center my-auto pointer-events-none">
          <div className="relative flex items-center justify-center">
            {/* Tech HUD Ring */}
            <div className="w-12 h-12 md:w-16 md:h-16 rounded-full border border-dashed border-cyan-400/40 animate-[spin_20s_linear_infinite] flex items-center justify-center">
              <div className="w-8 h-8 md:w-12 md:h-12 rounded-full border border-fuchsia-500/40" />
            </div>
            <span className={`absolute text-2xl md:text-4xl font-black ${textColor} filter drop-shadow-[0_0_12px_rgba(34,211,238,0.9)]`}>
              {suitSymbol}
            </span>
          </div>
        </div>

        {/* Bottom-Right Inverted Index */}
        <div className={`relative z-10 flex flex-col items-end leading-none font-mono font-black rotate-180 ${textColor}`}>
          <div className="flex items-center gap-0.5">
            <span className="text-base md:text-2xl tracking-tighter filter drop-shadow-[0_0_6px_rgba(34,211,238,0.8)]">
              {card.rank}
            </span>
          </div>
          <span className="text-xs md:text-lg filter drop-shadow-[0_0_8px_rgba(217,70,239,0.9)]">
            {suitSymbol}
          </span>
          <span className="text-[5.5px] md:text-[6.5px] font-mono text-cyan-400/60 uppercase tracking-widest mt-0.5">
            SYS:A7
          </span>
        </div>
      </div>
    );
  }

  // ==========================================
  // 4. ROYAL GOLD (EPIC SKIN)
  // ==========================================
  if (skin === 'gold') {
    const textColor = isRed ? 'text-amber-700' : 'text-yellow-950';
    const suitSymbol = suitIcons[card.suit];

    return (
      <div 
        onClick={!disabled ? onClick : undefined}
        onTouchEnd={!disabled ? onTouchEnd : undefined}
        style={style}
        className={`
          ${baseClasses}
          bg-gradient-to-br from-[#fef08a] via-[#fde047] to-[#eab308] border-2 border-amber-600/80 shadow-[0_0_15px_rgba(234,179,8,0.4)]
          flex flex-col justify-between p-1.5 md:p-3 cursor-pointer
          ${disabled ? 'opacity-40 grayscale scale-95 cursor-not-allowed' : 'md:hover:-translate-y-2 md:hover:shadow-[0_0_20px_rgba(234,179,8,0.6)] active:scale-95'}
          ${className}
        `}
      >
        <div className="absolute inset-1 rounded-lg border border-yellow-700/30 pointer-events-none" />
        <div className={`relative z-10 flex flex-col items-start leading-none font-black ${textColor}`}>
          <span className="text-lg md:text-2xl tracking-tighter">{card.rank}</span>
          <span className="text-xs md:text-lg">{suitSymbol}</span>
        </div>
        <div className={`central-icon text-3xl md:text-5xl self-center opacity-25 pointer-events-none ${textColor}`}>
          {suitSymbol}
        </div>
        <div className={`relative z-10 flex flex-col items-end leading-none font-black rotate-180 ${textColor}`}>
          <span className="text-lg md:text-2xl tracking-tighter">{card.rank}</span>
          <span className="text-xs md:text-lg">{suitSymbol}</span>
        </div>
      </div>
    );
  }

  // ==========================================
  // 5. COSMIC VOID (RARE SKIN)
  // ==========================================
  if (skin === 'void') {
    const textColor = isRed ? 'text-fuchsia-400' : 'text-purple-300';
    const suitSymbol = suitIcons[card.suit];

    return (
      <div 
        onClick={!disabled ? onClick : undefined}
        onTouchEnd={!disabled ? onTouchEnd : undefined}
        style={style}
        className={`
          ${baseClasses}
          bg-black border-2 border-purple-800 shadow-[0_0_15px_rgba(147,51,234,0.3)]
          flex flex-col justify-between p-1.5 md:p-3 cursor-pointer
          ${disabled ? 'opacity-40 grayscale scale-95 cursor-not-allowed' : 'md:hover:-translate-y-2 md:hover:shadow-purple-500/40 active:scale-95'}
          ${className}
        `}
      >
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(147,51,234,0.15),transparent)] pointer-events-none" />
        <div className={`relative z-10 flex flex-col items-start leading-none font-black ${textColor}`}>
          <span className="text-lg md:text-2xl tracking-tighter">{card.rank}</span>
          <span className="text-xs md:text-lg">{suitSymbol}</span>
        </div>
        <div className={`central-icon text-3xl md:text-5xl self-center opacity-20 pointer-events-none ${textColor}`}>
          {suitSymbol}
        </div>
        <div className={`relative z-10 flex flex-col items-end leading-none font-black rotate-180 ${textColor}`}>
          <span className="text-lg md:text-2xl tracking-tighter">{card.rank}</span>
          <span className="text-xs md:text-lg">{suitSymbol}</span>
        </div>
      </div>
    );
  }

  // ==========================================
  // 6. ELECTRIC NEON (UNCOMMON SKIN)
  // ==========================================
  if (skin === 'neon') {
    const textColor = isRed ? 'text-pink-400' : 'text-cyan-400';
    const suitSymbol = suitIcons[card.suit];

    return (
      <div 
        onClick={!disabled ? onClick : undefined}
        onTouchEnd={!disabled ? onTouchEnd : undefined}
        style={style}
        className={`
          ${baseClasses}
          bg-slate-900 border-2 border-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.3)]
          flex flex-col justify-between p-1.5 md:p-3 cursor-pointer
          ${disabled ? 'opacity-40 grayscale scale-95 cursor-not-allowed' : 'md:hover:-translate-y-2 md:hover:shadow-indigo-500/40 active:scale-95'}
          ${className}
        `}
      >
        <div className={`relative z-10 flex flex-col items-start leading-none font-black ${textColor}`}>
          <span className="text-lg md:text-2xl tracking-tighter">{card.rank}</span>
          <span className="text-xs md:text-lg">{suitSymbol}</span>
        </div>
        <div className={`central-icon text-3xl md:text-5xl self-center opacity-20 pointer-events-none ${textColor}`}>
          {suitSymbol}
        </div>
        <div className={`relative z-10 flex flex-col items-end leading-none font-black rotate-180 ${textColor}`}>
          <span className="text-lg md:text-2xl tracking-tighter">{card.rank}</span>
          <span className="text-xs md:text-lg">{suitSymbol}</span>
        </div>
      </div>
    );
  }

  // ==========================================
  // 7. GRAND CLASSIC (DEFAULT SKIN)
  // ==========================================
  const textColor = isRed ? 'text-red-600' : 'text-slate-900';
  const suitSymbol = suitIcons[card.suit];

  return (
    <div 
      onClick={!disabled ? onClick : undefined}
      onTouchEnd={!disabled ? onTouchEnd : undefined}
      style={style}
      className={`
        ${baseClasses}
        bg-white border-2 border-gray-200 shadow-2xl
        flex flex-col justify-between p-1.5 md:p-3 cursor-pointer
        ${disabled ? 'opacity-40 grayscale scale-95 cursor-not-allowed' : 'md:hover:-translate-y-2 md:hover:shadow-indigo-500/20 active:scale-95'}
        ${className}
      `}
    >
      <div className={`relative z-10 flex flex-col items-start leading-none font-black ${textColor}`}>
        <span className="text-lg md:text-2xl tracking-tighter">{card.rank}</span>
        <span className="text-xs md:text-lg">{suitSymbol}</span>
      </div>
      
      <div className={`central-icon text-4xl md:text-6xl self-center opacity-[0.1] pointer-events-none ${textColor}`}>
        {suitSymbol}
      </div>

      <div className={`relative z-10 flex flex-col items-end leading-none font-black rotate-180 ${textColor}`}>
        <span className="text-lg md:text-2xl tracking-tighter">{card.rank}</span>
        <span className="text-xs md:text-lg">{suitSymbol}</span>
      </div>
    </div>
  );
};

export default CardComponent;
