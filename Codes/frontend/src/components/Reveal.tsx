import { useEffect, useRef, useState, type ReactNode } from 'react';
import { motion, useInView, useReducedMotion, type TargetAndTransition, type Transition, type Variant } from 'framer-motion';

const canObserve = () => typeof window !== 'undefined' && 'IntersectionObserver' in window;

/**
 * Scroll reveal that can never leave content hidden:
 * - visible by default when the user prefers reduced motion or IntersectionObserver is missing;
 * - triggers when 15% of the element is in view (tall sections still trigger);
 * - falls back to revealing after 1.2 s even if the observer never fires
 *   (full-page screenshots, print, odd scroll containers).
 */
export function useReveal<T extends Element>(amount = 0.15) {
  const ref = useRef<T>(null);
  const reduce = useReducedMotion();
  const inView = useInView(ref, { once: true, amount });
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setTimedOut(true), 1200);
    return () => window.clearTimeout(t);
  }, []);
  const animateIn = !reduce && canObserve();
  return { ref, animateIn, shown: !animateIn || inView || timedOut };
}

type Common = {
  hidden: Variant;
  show: Variant;
  transition?: Transition;
  className?: string;
  children?: ReactNode;
  whileHover?: TargetAndTransition;
};

export function Reveal({ hidden, show, transition, className, children, whileHover }: Common) {
  const { ref, animateIn, shown } = useReveal<HTMLDivElement>();
  return (
    <motion.div
      ref={ref}
      className={className}
      variants={{ hidden, show }}
      initial={animateIn ? 'hidden' : false}
      animate={shown ? 'show' : 'hidden'}
      transition={transition}
      whileHover={whileHover}
    >
      {children}
    </motion.div>
  );
}

export function RevealLi({ hidden, show, transition, className, children, whileHover }: Common) {
  const { ref, animateIn, shown } = useReveal<HTMLLIElement>();
  return (
    <motion.li
      ref={ref}
      className={className}
      variants={{ hidden, show }}
      initial={animateIn ? 'hidden' : false}
      animate={shown ? 'show' : 'hidden'}
      transition={transition}
      whileHover={whileHover}
    >
      {children}
    </motion.li>
  );
}
