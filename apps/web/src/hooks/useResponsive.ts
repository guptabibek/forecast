import { useCallback, useEffect, useState } from 'react';

export const BREAKPOINTS = {
  mobile: 480,
  tablet: 768,
  laptop: 1024,
  desktop: 1280,
  wide: 1536,
} as const;

export type Breakpoint = keyof typeof BREAKPOINTS;

export type ScreenSize = 'mobile' | 'tablet' | 'laptop' | 'desktop' | 'wide';

function getScreenSize(width: number): ScreenSize {
  if (width < BREAKPOINTS.tablet) return 'mobile';
  if (width < BREAKPOINTS.laptop) return 'tablet';
  if (width < BREAKPOINTS.desktop) return 'laptop';
  if (width < BREAKPOINTS.wide) return 'desktop';
  return 'wide';
}

export function useScreenSize(): ScreenSize {
  const [size, setSize] = useState<ScreenSize>(() => getScreenSize(window.innerWidth));

  useEffect(() => {
    let rafId: number;
    const handleResize = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        setSize(getScreenSize(window.innerWidth));
      });
    };
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(rafId);
    };
  }, []);

  return size;
}

export function useIsMobile(): boolean {
  const size = useScreenSize();
  return size === 'mobile';
}

export function useIsTablet(): boolean {
  const size = useScreenSize();
  return size === 'tablet';
}

export function useIsCompact(): boolean {
  const size = useScreenSize();
  return size === 'mobile' || size === 'tablet';
}

export function useIsLaptop(): boolean {
  const size = useScreenSize();
  return size === 'laptop';
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener('change', handler);
    setMatches(mql.matches);
    return () => mql.removeEventListener('change', handler);
  }, [query]);

  return matches;
}

export type DensityMode = 'compact' | 'comfortable';

const DENSITY_KEY = 'erp-density-mode';

export function useDensityMode(): [DensityMode, (mode: DensityMode) => void] {
  const [density, setDensityState] = useState<DensityMode>(() => {
    const stored = localStorage.getItem(DENSITY_KEY);
    return (stored as DensityMode) || 'comfortable';
  });

  const setDensity = useCallback((mode: DensityMode) => {
    setDensityState(mode);
    localStorage.setItem(DENSITY_KEY, mode);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (density === 'compact') {
      root.classList.add('compact');
    } else {
      root.classList.remove('compact');
    }
  }, [density]);

  return [density, setDensity];
}
