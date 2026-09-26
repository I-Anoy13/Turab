import confetti from 'canvas-confetti';

let activeAnimationId: NodeJS.Timeout | null = null;

/**
 * Triggers a multi-stage celebratory confetti and particle display
 * Designed for round victories in Turab's Elite Card Series.
 */
export function triggerVictoryConfetti() {
  // Clear any existing active schedule
  if (activeAnimationId) {
    clearInterval(activeAnimationId);
    activeAnimationId = null;
  }

  // 1. Initial Explosive Center Cannon Blast
  confetti({
    particleCount: 100,
    spread: 90,
    origin: { y: 0.65 },
    colors: ['#ffd700', '#f59e0b', '#10b981', '#6366f1', '#ec4899', '#ffffff'],
    disableForReducedMotion: true,
    zIndex: 10000,
    ticks: 200,
    gravity: 1.1,
    scalar: 1.15
  });

  // 2. High-speed gold coin & star burst
  setTimeout(() => {
    confetti({
      particleCount: 60,
      angle: 90,
      spread: 120,
      origin: { x: 0.5, y: 0.7 },
      colors: ['#ffd700', '#fbbf24', '#fef08a', '#d97706'],
      zIndex: 10000,
      ticks: 250,
      gravity: 0.9,
      scalar: 1.3
    });
  }, 150);

  // 3. Dual Stadium Cannons from Bottom Left & Bottom Right Corners
  const duration = 3200;
  const animationEnd = Date.now() + duration;

  activeAnimationId = setInterval(() => {
    const timeLeft = animationEnd - Date.now();
    if (timeLeft <= 0) {
      if (activeAnimationId) {
        clearInterval(activeAnimationId);
        activeAnimationId = null;
      }
      return;
    }

    const particleCount = 28 * (timeLeft / duration);

    // Left cannon shooting up-right
    confetti({
      particleCount: Math.floor(particleCount),
      angle: 60,
      spread: 60,
      origin: { x: 0, y: 0.75 },
      colors: ['#ffd700', '#f59e0b', '#10b981', '#38bdf8'],
      zIndex: 10000,
      ticks: 180,
      gravity: 1
    });

    // Right cannon shooting up-left
    confetti({
      particleCount: Math.floor(particleCount),
      angle: 120,
      spread: 60,
      origin: { x: 1, y: 0.75 },
      colors: ['#ffd700', '#ec4899', '#8b5cf6', '#34d399'],
      zIndex: 10000,
      ticks: 180,
      gravity: 1
    });

    // Gentle star showers from ceiling
    confetti({
      particleCount: 12,
      origin: { x: Math.random(), y: 0 },
      spread: 70,
      gravity: 0.6,
      colors: ['#ffd700', '#ffffff', '#a855f7'],
      zIndex: 10000,
      ticks: 140,
      scalar: 0.9
    });
  }, 220);
}

/**
 * Manually halts any running confetti sequences (e.g. on modal dismiss)
 */
export function stopVictoryConfetti() {
  if (activeAnimationId) {
    clearInterval(activeAnimationId);
    activeAnimationId = null;
  }
  confetti.reset();
}
