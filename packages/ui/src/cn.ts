import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Canonical Tailwind-aware className joiner for web, admin, and space.
 * Merges conflicting Tailwind utilities (last wins) via tailwind-merge.
 */
export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs));

export type { ClassValue };
