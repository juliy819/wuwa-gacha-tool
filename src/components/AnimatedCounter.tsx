import { useEffect, useRef, useState } from 'react';

interface UseAnimatedCounterOptions {
  duration?: number;
  delay?: number;
  easing?: (t: number) => number;
}

function easeOutExpo(t: number): number {
  return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

function useAnimatedCounter(
  target: number,
  options: UseAnimatedCounterOptions = {}
): number {
  const { duration = 1200, delay = 0, easing = easeOutExpo } = options;
  const [current, setCurrent] = useState(0);
  const prevTarget = useRef(0);
  const animFrame = useRef<number>(0);

  useEffect(() => {
    const startValue = prevTarget.current;
    const diff = target - startValue;

    if (diff === 0) return;

    let startTime: number | null = null;
    const delayTimeout = setTimeout(() => {
      const step = (timestamp: number) => {
        if (!startTime) startTime = timestamp;
        const elapsed = timestamp - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const easedProgress = easing(progress);

        setCurrent(Math.round(startValue + diff * easedProgress));

        if (progress < 1) {
          animFrame.current = requestAnimationFrame(step);
        } else {
          prevTarget.current = target;
        }
      };

      animFrame.current = requestAnimationFrame(step);
    }, delay);

    return () => {
      clearTimeout(delayTimeout);
      cancelAnimationFrame(animFrame.current);
    };
  }, [target, duration, delay, easing]);

  return current;
}

interface AnimatedCounterProps {
  value: number;
  duration?: number;
  delay?: number;
  className?: string;
  prefix?: string;
  suffix?: string;
  formatter?: (val: number) => string;
  shimmer?: boolean;
  /** 数值变化时触发柔和的白色光晕脉冲 */
  pulse?: boolean;
  /** 达到里程碑 [100, 500, 1000, 5000, 10000] 时触发金色庆祝，优先级高于 pulse */
  milestone?: boolean;
}

const MILESTONES = [100, 500, 1000, 5000, 10000];

export default function AnimatedCounter({
  value,
  duration = 1200,
  delay = 0,
  className = '',
  prefix = '',
  suffix = '',
  formatter,
  shimmer = false,
  pulse = false,
  milestone = false,
}: AnimatedCounterProps) {
  const animatedValue = useAnimatedCounter(value, { duration, delay });
  const displayValue = formatter ? formatter(animatedValue) : animatedValue.toLocaleString();

  const [pulseKey, setPulseKey] = useState(0);
  const prevValue = useRef(value);
  const justCrossedMilestone = useRef(false);

  useEffect(() => {
    if (prevValue.current === value) return;
    const oldValue = prevValue.current;
    prevValue.current = value;

    if (milestone) {
      const crossed = MILESTONES.find(
        (m) => value >= m && oldValue < m
      );
      if (crossed) {
        justCrossedMilestone.current = true;
        setPulseKey((k) => k + 1);
        return;
      }
    }

    if (pulse) {
      setPulseKey((k) => k + 1);
    }
  }, [value, pulse, milestone]);

  const animationClass = justCrossedMilestone.current && pulseKey > 0
    ? 'number-milestone'
    : pulseKey > 0
    ? 'number-pulse'
    : '';

  return (
    <span
      key={pulseKey}
      className={`${shimmer ? `${className} number-shimmer` : className} ${animationClass}`}
    >
      {prefix}{displayValue}{suffix}
    </span>
  );
}
