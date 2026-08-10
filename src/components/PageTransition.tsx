interface PageTransitionProps {
  children: React.ReactNode;
}

export default function PageTransition({ children }: PageTransitionProps) {
  return (
    <div className="page-transition relative h-full w-full overflow-hidden">
      {children}
    </div>
  );
}
