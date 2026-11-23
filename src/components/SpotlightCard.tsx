import { useCallback, useRef } from 'react';
import type { PointerEvent, ReactNode } from 'react';
import { motion } from 'motion/react';

export const CLIMA_EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];
export const CLIMA_SPRING_EASE: [number, number, number, number] = [0.34, 1.56, 0.64, 1];

interface SpotlightCardProps {
  children: ReactNode;
  className?: string;
  staggerIndex?: number;
  tone?: 'cyan' | 'amber';
  as?: 'section' | 'div';
  ariaLabel?: string;
  id?: string;
}

export function SpotlightCard({
  children,
  className = '',
  staggerIndex = 0,
  tone = 'cyan',
  as = 'section',
  ariaLabel,
  id,
}: SpotlightCardProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const handlePointerMove = useCallback((e: PointerEvent<HTMLElement>) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty('--spot-x', `${e.clientX - rect.left}px`);
    el.style.setProperty('--spot-y', `${e.clientY - rect.top}px`);
    el.style.setProperty('--spot-opacity', '1');
  }, []);

  const handlePointerLeave = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    el.style.setProperty('--spot-opacity', '0');
  }, []);

  const MotionTag = as === 'div' ? motion.div : motion.section;

  return (
    <MotionTag
      ref={containerRef}
      id={id}
      aria-label={ariaLabel}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      initial={{ opacity: 0, y: 14, scale: 0.99 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{
        duration: 0.42,
        delay: staggerIndex * 0.05,
        ease: CLIMA_EASE,
      }}
      className={`alabaster-card relative overflow-hidden rounded-[28px] ${className}`}
    >
      <div
        aria-hidden="true"
        className={`spotlight-overlay ${tone === 'amber' ? 'spotlight-overlay-amber' : ''}`}
      />
      <div className="relative z-10">{children}</div>
    </MotionTag>
  );
}
