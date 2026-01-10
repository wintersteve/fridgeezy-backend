import { create } from "zustand";

import { ProfileSettingsData } from "@/core/supabase";

export interface IngredientsFilterState {
  restrictions: string[];
  blacklist: string[];
  cuisine: string;
  course: string;
  component: string;
  difficulty: string | null;
}

export interface IngredientsFilterActions {
  initializeFromDB: (value?: {
    settings: ProfileSettingsData;
    restrictions: string[];
  }) => void;
  setRestrictions: (value: string[]) => void;
  setBlacklist: (value: string[]) => void;
  setCuisine: (value: string) => void;
  setCourse: (value: string) => void;
  setComponent: (value: string) => void;
  setDifficulty: (value: string) => void;
  resetFilter: (key: keyof IngredientsFilterState) => void;
  resetSessionFilters: () => void;
  resetAll: () => void;
}

const initialState: IngredientsFilterState = {
  restrictions: [],
  blacklist: [],
  cuisine: "",
  course: "",
  component: "",
  difficulty: "",
};

export const useIngredientsFilterStore = create<
  IngredientsFilterState & IngredientsFilterActions
>()((set) => ({
  ...initialState,
  initializeFromDB: (value) =>
    set(() => ({
      difficulty: value?.settings?.difficulty,
      restrictions: value?.restrictions,
    })),
  setRestrictions: (value) => set(() => ({ restrictions: value })),
  setBlacklist: (value) => set(() => ({ blacklist: value })),
  setCuisine: (value) => set(() => ({ cuisine: value })),
  setCourse: (value) => set(() => ({ course: value })),
  setComponent: (value) => set(() => ({ component: value })),
  setDifficulty: (value) => set(() => ({ difficulty: value })),
  resetFilter: (key) => set(() => ({ [key]: initialState[key] })),
  resetSessionFilters: () =>
    set(() => ({
      cuisine: "",
      course: "",
      component: "",
    })),
  resetAll: () => set(() => initialState),
}));
