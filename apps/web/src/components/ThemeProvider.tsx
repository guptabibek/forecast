import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { settingsService, type TenantSettings } from '../services/api/settings.service';
import { useAuthStore } from '../stores/auth.store';

/* ─── Types ─── */
export interface BrandingContext {
  settings: TenantSettings | null;
  isLoading: boolean;
  /** Current theme mode actually applied */
  themeMode: 'light' | 'dark';
  /** Toggle between light / dark */
  toggleTheme: () => void;
  /** Force a specific mode */
  setThemeMode: (mode: 'light' | 'dark') => void;
  /** Refresh settings from API */
  refresh: () => void;
}

const ThemeCtx = createContext<BrandingContext>({
  settings: null,
  isLoading: true,
  themeMode: 'light',
  toggleTheme: () => {},
  setThemeMode: () => {},
  refresh: () => {},
});

export const useBranding = () => useContext(ThemeCtx);

/* ─── Helpers ─── */

/** Generate a simple shade palette from a single hex  */
function generateShades(hex: string): Record<string, string> {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);

  const lighten = (amt: number) => {
    const lr = Math.min(255, Math.round(r + (255 - r) * amt));
    const lg = Math.min(255, Math.round(g + (255 - g) * amt));
    const lb = Math.min(255, Math.round(b + (255 - b) * amt));
    return `${lr} ${lg} ${lb}`;
  };

  const darken = (amt: number) => {
    const dr = Math.max(0, Math.round(r * (1 - amt)));
    const dg = Math.max(0, Math.round(g * (1 - amt)));
    const db = Math.max(0, Math.round(b * (1 - amt)));
    return `${dr} ${dg} ${db}`;
  };

  return {
    '50': lighten(0.92),
    '100': lighten(0.84),
    '200': lighten(0.7),
    '300': lighten(0.5),
    '400': lighten(0.25),
    '500': `${r} ${g} ${b}`,
    '600': darken(0.15),
    '700': darken(0.3),
    '800': darken(0.45),
    '900': darken(0.6),
    '950': darken(0.75),
  };
}

/** Load a Google Font dynamically */
function loadGoogleFont(family: string) {
  const id = `gf-${family.replace(/\s+/g, '-').toLowerCase()}`;
  if (document.getElementById(id)) return;
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@300;400;500;600;700;800;900&display=swap`;
  document.head.appendChild(link);
}

/* ─── Provider ─── */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { isAuthenticated } = useAuthStore();
  const [themeKey, setThemeKey] = useState(0); // Used to trigger useEffect on theme change

  const { data: settings, isLoading } = useQuery<TenantSettings>({
    queryKey: ['tenant-settings'],
    queryFn: () => settingsService.fetchSettings(),
    staleTime: 2 * 60 * 1000,
    retry: 1,
    enabled: isAuthenticated, // Only fetch when authenticated
  });

  /* ─ Theme mode management ─ */
  const resolveInitialTheme = useCallback((): 'light' | 'dark' => {
    const stored = localStorage.getItem('themeMode');
    if (stored === 'light' || stored === 'dark') return stored;
    if (settings?.defaultTheme === 'dark') return 'dark';
    if (settings?.defaultTheme === 'system') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'light';
  }, [settings?.defaultTheme]);

  const themeMode = useMemo(resolveInitialTheme, [resolveInitialTheme]);

  const setThemeMode = useCallback((mode: 'light' | 'dark') => {
    localStorage.setItem('themeMode', mode);
    document.documentElement.classList.toggle('dark', mode === 'dark');
    // Trigger re-calculation of CSS variables
    setThemeKey(k => k + 1);
  }, []);

  const toggleTheme = useCallback(() => {
    const current = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
    setThemeMode(current === 'dark' ? 'light' : 'dark');
  }, [setThemeMode]);

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['tenant-settings'] });
  }, [queryClient]);

  /* ─ Apply CSS variables whenever settings or theme change ─ */
  useEffect(() => {
    if (!settings) return;

    // Debug log - remove after fixing
    console.log('[ThemeProvider] Applying settings:', {
      sidebarBg: settings.sidebarBg,
      headerBg: settings.headerBg,
      primaryColor: settings.primaryColor,
      themeKey,
    });

    const root = document.documentElement;

    // Theme mode
    const stored = localStorage.getItem('themeMode');
    if (!stored) {
      // Apply default from settings
      if (settings.defaultTheme === 'dark') {
        root.classList.add('dark');
      } else if (settings.defaultTheme === 'system') {
        root.classList.toggle('dark', window.matchMedia('(prefers-color-scheme: dark)').matches);
      } else {
        root.classList.remove('dark');
      }
    } else {
      root.classList.toggle('dark', stored === 'dark');
    }

    // Primary color → CSS variables for full palette
    if (settings.primaryColor) {
      const shades = generateShades(settings.primaryColor);
      Object.entries(shades).forEach(([shade, rgb]) => {
        root.style.setProperty(`--color-primary-${shade}`, rgb);
      });
      root.style.setProperty('--color-primary', shades['500']);
    }

    // Accent color
    if (settings.accentColor) {
      const shades = generateShades(settings.accentColor);
      Object.entries(shades).forEach(([shade, rgb]) => {
        root.style.setProperty(`--color-accent-${shade}`, rgb);
      });
    }

    // Sidebar colors - ALWAYS set to ensure they override CSS cascade
    // Use the settings value, or fallback to theme-appropriate defaults
    const isDark = root.classList.contains('dark');
    const sidebarBgValue = settings.sidebarBg || (isDark ? '#1e293b' : '#ffffff');
    const sidebarTextValue = settings.sidebarText || (isDark ? '#f8fafc' : '#334155');
    root.style.setProperty('--sidebar-bg', sidebarBgValue);
    root.style.setProperty('--sidebar-text', sidebarTextValue);

    // Header colors - ALWAYS set to ensure they override CSS cascade
    const headerBgValue = settings.headerBg || (isDark ? '#1e293b' : '#ffffff');
    const headerTextValue = settings.headerText || (isDark ? '#f8fafc' : '#0f172a');
    root.style.setProperty('--header-bg', headerBgValue);
    root.style.setProperty('--header-text', headerTextValue);

    // Typography
    if (settings.headingFont && settings.headingFont !== 'Inter') {
      loadGoogleFont(settings.headingFont);
      root.style.setProperty('--font-heading', `'${settings.headingFont}', system-ui, sans-serif`);
    } else {
      root.style.setProperty('--font-heading', "'Inter var', 'Inter', system-ui, sans-serif");
    }

    if (settings.bodyFont && settings.bodyFont !== 'Inter') {
      loadGoogleFont(settings.bodyFont);
      root.style.setProperty('--font-body', `'${settings.bodyFont}', system-ui, sans-serif`);
    } else {
      root.style.setProperty('--font-body', "'Inter var', 'Inter', system-ui, sans-serif");
    }

    root.style.setProperty('--font-size-base', `${settings.baseFontSize || 14}px`);
    root.style.setProperty('--font-weight-heading', `${settings.headingWeight || 700}`);

    // Border radius
    root.style.setProperty('--radius', `${settings.borderRadius ?? 8}px`);

    // Compact mode
    root.classList.toggle('compact', !!settings.compactMode);

    // Favicon
    if (settings.faviconUrl) {
      let link = document.querySelector("link[rel~='icon']") as HTMLLinkElement | null;
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.head.appendChild(link);
      }
      link.href = settings.faviconUrl;
    }

    // Custom CSS
    const customStyleId = 'tenant-custom-css';
    let customStyle = document.getElementById(customStyleId) as HTMLStyleElement | null;
    if (settings.customCss) {
      if (!customStyle) {
        customStyle = document.createElement('style');
        customStyle.id = customStyleId;
        document.head.appendChild(customStyle);
      }
      customStyle.textContent = settings.customCss;
    } else if (customStyle) {
      customStyle.remove();
    }
  }, [settings, themeKey]);

  const ctx = useMemo<BrandingContext>(
    () => ({
      settings: settings ?? null,
      isLoading,
      themeMode,
      toggleTheme,
      setThemeMode,
      refresh,
    }),
    [settings, isLoading, themeMode, toggleTheme, setThemeMode, refresh],
  );

  return <ThemeCtx.Provider value={ctx}>{children}</ThemeCtx.Provider>;
}
