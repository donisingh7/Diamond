import type { Transition, Variants } from "motion/react";

export const motionTiming = { fast: 0.12, base: 0.18, slow: 0.3 } as const;
export const easeStandard = [0.2, 0, 0, 1] as const;
export const easeEmphasized = [0.16, 1, 0.3, 1] as const;
export const springInteractive: Transition = { type: "spring", stiffness: 420, damping: 32, mass: 0.8 };
export const springSheet: Transition = { type: "spring", stiffness: 330, damping: 34, mass: 1 };
export const baseTransition: Transition = { duration: motionTiming.base, ease: easeStandard };
export const fadeIn: Variants = { hidden: { opacity: 0 }, visible: { opacity: 1 }, exit: { opacity: 0 } };
export const fadeUp: Variants = { hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0 }, exit: { opacity: 0, y: 4 } };
export const scaleIn: Variants = { hidden: { opacity: 0, scale: 0.97 }, visible: { opacity: 1, scale: 1 }, exit: { opacity: 0, scale: 0.98 } };
export const modalEnter = scaleIn;
export const sheetEnter: Variants = { hidden: { y: "100%" }, visible: { y: 0 }, exit: { y: "100%" } };
export const drawerEnter: Variants = { hidden: { x: "-100%" }, visible: { x: 0 }, exit: { x: "-100%" } };
export const pageEnter = fadeUp;

/** MotionConfig removes transforms; this also removes explicit layout/press motion. */
export function calmVariants(variants: Variants, reduced: boolean | null): Variants {
  return reduced ? fadeIn : variants;
}
