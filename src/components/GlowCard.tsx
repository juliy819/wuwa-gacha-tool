import { useRef, useState, ReactNode } from 'react';
import { motion, MotionProps } from 'framer-motion';
import { cn } from '../lib/utils';

interface GlowCardProps extends MotionProps {
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
  glowColor?: string;
  glowSize?: number;
}

/**
 * 卡片容器：鼠标悬浮时跟随光晕，支持 framer-motion 入场动画。
 */
export default function GlowCard({
  children,
  className = '',
  style,
  glowColor = 'rgba(212, 212, 212, 0.08)',
  glowSize = 280,
  ...motionProps
}: GlowCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [glowPosition, setGlowPosition] = useState({ x: 0, y: 0 });
  const [isHovered, setIsHovered] = useState(false);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const card = cardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    setGlowPosition({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  return (
    <motion.div
      ref={cardRef}
      className={cn('relative overflow-hidden', className)}
      style={style}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      {...motionProps}
    >
      <div
        className="absolute pointer-events-none transition-opacity duration-500"
        style={{
          left: glowPosition.x - glowSize / 2,
          top: glowPosition.y - glowSize / 2,
          width: glowSize,
          height: glowSize,
          background: `radial-gradient(circle, ${glowColor}, transparent 70%)`,
          opacity: isHovered ? 1 : 0,
          borderRadius: '50%',
          zIndex: 0,
        }}
      />
      <div className="relative" style={{ zIndex: 1 }}>{children}</div>
    </motion.div>
  );
}
