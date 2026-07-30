import { motion } from 'framer-motion';
import { cn } from '../lib/utils';

interface StatCardProps {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
  color?: 'default' | 'gold' | 'purple' | 'blue';
  className?: string;
  delay?: number;
}

export default function StatCard({
  label,
  value,
  icon,
  color = 'default',
  className = '',
  delay = 0,
}: StatCardProps) {
  const colorClasses = {
    default: 'text-tide',
    gold: 'text-[#e8d4a8]',
    purple: 'text-[#b8a8d8]',
    blue: 'text-[#a8c8e8]',
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        'glass-card p-4 flex flex-col gap-2',
        className
      )}
    >
      <div className="flex items-center gap-2 text-wave text-xs">
        {icon && <span>{icon}</span>}
        <span>{label}</span>
      </div>
      <div className={cn('text-2xl font-semibold tracking-tight', colorClasses[color])}>
        {value}
      </div>
    </motion.div>
  );
}
