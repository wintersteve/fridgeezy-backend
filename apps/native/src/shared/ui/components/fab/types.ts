import type { ReactNode } from "react";

export interface FabAction {
  icon: string;
  content: ReactNode;
  onPress: () => void;
  color?: string;
  backgroundColor?: string;
}

export interface FabActionGroup {
  actions: FabAction[];
}

export interface FabProps {
  groups: FabActionGroup[];
  icon?: string;
  closeIcon?: string;
  color?: string;
  backgroundColor?: string;
  position?: {
    bottom?: number;
    right?: number;
    left?: number;
    top?: number;
  };
  visible?: boolean;
  onStateChange?: (open: boolean) => void;
}
