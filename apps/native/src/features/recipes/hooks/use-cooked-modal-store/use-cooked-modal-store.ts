import { create } from "zustand";

export type CookedModalState = {
  toggle: (visible?: boolean) => void;
  visible: boolean;
};

export const useCookedModalStore = create<CookedModalState>()((set) => ({
  toggle: (visible) => set((state) => ({ visible: visible ?? !state.visible })),
  visible: false,
}));
