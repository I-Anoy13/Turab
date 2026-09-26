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

const skinStyles = {
  classic: { bg: 'bg-white', border: 'border-gray-100', text: { red: 'text-red-600', black: 'text-slate-900' } },
  neon: { bg: 'bg-slate-900', border: 'border-indigo-500', text: { red: 'text-pink-400', black: 'text-cyan-400' } },
  gold: { bg: 'bg-gradient-to-br from-yellow-100 to-yellow-400', border: 'border-yellow-600', text: { red: 'text-orange-700', black: 'text-yellow-900' } },
  void: { bg: 'bg-black', border: 'border-purple-900', text: { red: 'text-purple-400', black: 'text-slate-200' } },
  inferno: { bg: 'bg-gradient-to-br from-[#2a0808] via-[#150505] to-[#3b0d0c]', border: 'border-orange-500/80 shadow-[0_0_15px_rgba(249,115,22,0.4)]', text: { red: 'text-amber-400', black: 'text-orange-400' } },
  cyberpunk: { bg: 'bg-gradient-to-br from-[#060e24] via-[#091534] to-[#1a082c]', border: 'border-cyan-400/80 shadow-[0_0_15px_rgba(34,211,238,0.4)]', text: { red: 'text-fuchsia-400', black: 'text-cyan-300' } }
};

const CardComponent: React.FC<CardComponentProps> = ({ 
  card, 
  hidden = false, 
  onClick, 
  onTouchEnd,
  disabled = false,
  className = "",
  style,
  skin = 'classic'
}) => {
  const baseClasses = "w-[65px] h-[92px] md:w-[95px] md:h-[135px] rounded-xl border-2 shadow-2xl transition-all duration-200 overflow-hidden select-none";
  const s = skinStyles[skin] || skinStyles.classic;

  if (hidden) {
    return (
      <div 
        className={`${baseClasses} bg-[#0f172a] border-[#1e293b] flex items-center justify-center ${className}`}
        style={style}
      >
        <div className="w-full h-full m-1 border-2 border-indigo-500/20 rounded-lg flex items-center justify-center bg-gradient-to-br from-[#1e293b] to-[#0f172a]">
            <div className="w-8 h-8 rounded-full bg-indigo-500/10 border border-indigo-400/20 animate-pulse"></div>
        </div>
      </div>
    );
  }

  if (!card) return null;
  const isRed = card.suit === 'hearts' || card.suit === 'diamonds';
  const textColor = isRed ? s.text.red : s.text.black;

  return (
    <div 
      onClick={!disabled ? onClick : undefined}
      onTouchEnd={!disabled ? onTouchEnd : undefined}
      style={style}
      className={`
        ${baseClasses} ${s.bg} ${s.border} flex flex-col justify-between p-1.5 md:p-3 cursor-pointer
        ${disabled ? 'opacity-40 grayscale scale-95 cursor-not-allowed' : 'md:hover:-translate-y-2 md:hover:shadow-indigo-500/20 active:scale-95'}
        ${className}
      `}
    >
      <div className={`flex flex-col items-start leading-none font-black ${textColor}`}>
        <span className="text-lg md:text-2xl tracking-tighter">{card.rank}</span>
        <span className="text-xs md:text-lg">{suitIcons[card.suit]}</span>
      </div>
      
      <div className={`central-icon text-4xl md:text-6xl self-center opacity-[0.1] pointer-events-none ${textColor}`}>
        {suitIcons[card.suit]}
      </div>

      <div className={`flex flex-col items-end leading-none font-black rotate-180 ${textColor}`}>
        <span className="text-lg md:text-2xl tracking-tighter">{card.rank}</span>
        <span className="text-xs md:text-lg">{suitIcons[card.suit]}</span>
      </div>
    </div>
  );
};

export default CardComponent;