import { create } from "zustand/index";
import { createJSONStorage, persist } from "zustand/middleware";

import { createStorage } from "@/shared/local-storage";

import { Unit } from "../../types";

export interface UnitItem {
  id: Unit;
}

export type UnitState = {
  data: UnitItem;
  setMetric: VoidFunction;
  setImperial: VoidFunction;
};

export const useUnitStore = create<UnitState>()(
  persist(
    (set) => ({
      data: { id: "METRIC" },
      setImperial: () => set(() => ({ data: { id: "IMPERIAL" } })),
      setMetric: () => set(() => ({ data: { id: "METRIC" } })),
    }),
    {
      name: "UNIT_STORE",
      storage: createJSONStorage(createStorage),
    },
  ),
);
