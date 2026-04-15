import { create } from 'zustand';

interface ApiLoadingState {
  /** Number of in-flight mutation requests (POST / PUT / PATCH / DELETE) */
  inflightCount: number;
  /** True when at least one mutation is in-flight */
  isLoading: boolean;
  _increment: () => void;
  _decrement: () => void;
}

export const useApiLoadingStore = create<ApiLoadingState>((set) => ({
  inflightCount: 0,
  isLoading: false,
  _increment: () =>
    set((s) => {
      const next = s.inflightCount + 1;
      return { inflightCount: next, isLoading: next > 0 };
    }),
  _decrement: () =>
    set((s) => {
      const next = Math.max(0, s.inflightCount - 1);
      return { inflightCount: next, isLoading: next > 0 };
    }),
}));
