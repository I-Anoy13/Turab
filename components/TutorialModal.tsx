import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { soundEffects } from '../soundEffects';
import { ChevronLeft, ChevronRight, X, BookOpen, Smartphone } from 'lucide-react';

export interface TutorialPageData {
  title: string;
  subtitle: string;
  icon: string;
  content: string;
}

export const TUTORIAL_PAGES: TutorialPageData[] = [
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

interface TutorialModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialPage?: number;
}

export const TutorialModal: React.FC<TutorialModalProps> = ({
  isOpen,
  onClose,
  initialPage = 0
}) => {
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [direction, setDirection] = useState<1 | -1>(1);

  // Sync initialPage when modal opens
  useEffect(() => {
    if (isOpen) {
      setCurrentPage(initialPage);
    }
  }, [isOpen, initialPage]);

  const goToNext = useCallback(() => {
    if (currentPage < TUTORIAL_PAGES.length - 1) {
      soundEffects.playCard();
      setDirection(1);
      setCurrentPage(prev => prev + 1);
    }
  }, [currentPage]);

  const goToPrev = useCallback(() => {
    if (currentPage > 0) {
      soundEffects.playCard();
      setDirection(-1);
      setCurrentPage(prev => prev - 1);
    }
  }, [currentPage]);

  // Desktop Keyboard Arrow Navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'KeyD') {
        e.preventDefault();
        goToNext();
      } else if (e.key === 'ArrowLeft' || e.key === 'KeyA') {
        e.preventDefault();
        goToPrev();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, goToNext, goToPrev, onClose]);

  // Mobile Native Touch Fallback Handler
  const touchStartXRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartXRef.current = e.touches[0].clientX;
    touchStartYRef.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartXRef.current === null || touchStartYRef.current === null) return;
    const diffX = e.changedTouches[0].clientX - touchStartXRef.current;
    const diffY = e.changedTouches[0].clientY - touchStartYRef.current;

    // Only register horizontal swipes if horizontal displacement is significantly greater than vertical
    if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 45) {
      if (diffX < 0) {
        // Swiped Left -> Next page
        goToNext();
      } else {
        // Swiped Right -> Previous page
        goToPrev();
      }
    }
    touchStartXRef.current = null;
    touchStartYRef.current = null;
  };

  if (!isOpen) return null;

  const currentData = TUTORIAL_PAGES[currentPage];

  // Slide transition variants
  const slideVariants = {
    enter: (dir: number) => ({
      x: dir > 0 ? 60 : -60,
      opacity: 0,
      scale: 0.96
    }),
    center: {
      x: 0,
      opacity: 1,
      scale: 1,
      transition: {
        duration: 0.25,
        ease: 'easeOut' as const
      }
    },
    exit: (dir: number) => ({
      x: dir > 0 ? -60 : 60,
      opacity: 0,
      scale: 0.96,
      transition: {
        duration: 0.2,
        ease: 'easeIn' as const
      }
    })
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 flex items-center justify-center z-[500] p-4 select-none">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-black/85 backdrop-blur-md"
        />

        {/* Modal Card */}
        <motion.div
          initial={{ scale: 0.9, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.9, opacity: 0, y: 20 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="relative w-full max-w-md glass-panel p-6 md:p-8 rounded-[2.5rem] border border-indigo-500/30 bg-gradient-to-b from-[#111226] via-[#090b16] to-[#05060f] shadow-[0_25px_65px_rgba(0,0,0,0.85)] z-10 text-left mx-auto flex flex-col overflow-hidden"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          {/* Subtle ambient glow header */}
          <div className="absolute -top-16 left-1/2 -translate-x-1/2 w-64 h-24 bg-indigo-500/20 rounded-full blur-3xl pointer-events-none" />

          {/* Top Bar: Navigation Hints & Close Button */}
          <div className="flex items-center justify-between mb-3 relative z-10">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 font-mono text-[8px] font-black uppercase tracking-wider">
                PAGE {currentPage + 1} / {TUTORIAL_PAGES.length}
              </span>
              <span className="hidden sm:inline-flex items-center gap-1 text-[8px] font-bold text-white/40 uppercase tracking-wider">
                <span>⌨️</span>
                <span>Use ← → keys</span>
              </span>
              <span className="inline-flex sm:hidden items-center gap-1 text-[8px] font-bold text-indigo-400/70 uppercase tracking-wider">
                <Smartphone size={10} />
                <span>Swipe ↔</span>
              </span>
            </div>

            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full border border-white/10 hover:border-white/30 hover:bg-white/10 flex items-center justify-center transition-all text-xs font-black text-white/50 hover:text-white cursor-pointer"
              title="Close (Esc)"
            >
              <X size={14} />
            </button>
          </div>

          {/* Swipeable Motion Content Container */}
          <motion.div
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.3}
            onDragEnd={(_, info) => {
              const swipeThreshold = 40;
              if (info.offset.x < -swipeThreshold || info.velocity.x < -250) {
                goToNext();
              } else if (info.offset.x > swipeThreshold || info.velocity.x > 250) {
                goToPrev();
              }
            }}
            className="cursor-grab active:cursor-grabbing touch-pan-y relative"
          >
            <AnimatePresence mode="wait" custom={direction}>
              <motion.div
                key={`tutorial-page-${currentPage}`}
                custom={direction}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                className="w-full"
              >
                {/* Header with Title and Icon */}
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-13 h-13 rounded-2xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-2xl shadow-inner shrink-0">
                    {currentData.icon}
                  </div>
                  <div>
                    <h2 className="text-xl font-black uppercase tracking-tight text-white group-hover:text-indigo-300 transition-colors">
                      {currentData.title}
                    </h2>
                    <p className="text-[10px] font-black text-indigo-400/80 uppercase tracking-wider mt-0.5">
                      {currentData.subtitle}
                    </p>
                  </div>
                </div>

                {/* Divider */}
                <div className="h-px bg-white/10 my-3" />

                {/* Body Text Card */}
                <div className="p-4 rounded-2xl bg-white/5 border border-white/5 min-h-[145px] flex items-center">
                  <p className="text-[12.5px] font-medium text-white/80 leading-relaxed whitespace-pre-wrap">
                    {currentData.content}
                  </p>
                </div>
              </motion.div>
            </AnimatePresence>
          </motion.div>

          {/* Interactive Progress Indicators (Clickable dots) */}
          <div className="flex items-center justify-center gap-2 my-5">
            {TUTORIAL_PAGES.map((_, i) => (
              <button
                key={`tutorial-dot-${i}`}
                onClick={() => {
                  soundEffects.playCard();
                  setDirection(i > currentPage ? 1 : -1);
                  setCurrentPage(i);
                }}
                className={`h-1.5 rounded-full transition-all duration-300 cursor-pointer ${
                  i === currentPage
                    ? 'w-7 bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.6)]'
                    : 'w-2 bg-white/20 hover:bg-white/40'
                }`}
                title={`Jump to Page ${i + 1}`}
              />
            ))}
          </div>

          {/* Modal Footer Controls with Desktop Key Indicators */}
          <div className="grid grid-cols-2 gap-3 mt-1">
            <button
              onClick={goToPrev}
              disabled={currentPage === 0}
              className="py-3.5 px-4 rounded-2xl bg-white/5 border border-white/10 text-[10px] font-black uppercase text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-25 disabled:hover:bg-white/5 transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:cursor-not-allowed"
            >
              <ChevronLeft size={14} />
              <span>Previous</span>
            </button>

            {currentPage < TUTORIAL_PAGES.length - 1 ? (
              <button
                onClick={goToNext}
                className="gold-button py-3.5 px-4 rounded-2xl text-[10px] font-black uppercase tracking-wider flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <span>Next</span>
                <ChevronRight size={14} />
              </button>
            ) : (
              <button
                onClick={() => {
                  soundEffects.playCard();
                  onClose();
                }}
                className="gold-button py-3.5 px-4 rounded-2xl text-[10px] font-black uppercase tracking-wider flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <span>Got It!</span>
                <span>✨</span>
              </button>
            )}
          </div>

          {/* Bottom Gestures / Keyboard Hint Strip */}
          <div className="mt-3 text-center">
            <div className="text-[8px] font-mono font-medium text-white/35 uppercase flex items-center justify-center gap-2">
              <span className="hidden sm:inline">Use [←] / [→] arrows</span>
              <span className="hidden sm:inline">•</span>
              <span>Swipe left or right to flip</span>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

export default TutorialModal;
