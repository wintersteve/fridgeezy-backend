import { Badge as RNPBadge } from "react-native-paper";

import { useTheme } from "@/shared/theme";

export interface BadgeProps {
  borderRadius?: number;
  children: string | number;
}

export const Badge = (props: BadgeProps) => {
  const { borderRadius = 100, children } = props;

  const theme = useTheme();

  return (
    <RNPBadge
      style={{
        backgroundColor: theme.colors.primaryContainer,
        borderRadius,
        color: theme.colors.primary,
        fontWeight: 700,
      }}
    >
      {children}
    </RNPBadge>
  );
};
