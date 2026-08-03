import { motion } from 'framer-motion';

interface PageTransitionProps {
  children: React.ReactNode;
}

export default function PageTransition({ children }: PageTransitionProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      className="page-transition relative h-full w-full overflow-hidden"
    >
      <motion.span
        className="page-entry-scan"
        initial={{ x: '-100%', opacity: 0 }}
        animate={{ x: '118%', opacity: [0, 0.72, 0] }}
        transition={{ duration: 0.62, times: [0, 0.26, 1], ease: [0.16, 1, 0.3, 1] }}
        aria-hidden="true"
      />
      {children}
    </motion.div>
  );
}
