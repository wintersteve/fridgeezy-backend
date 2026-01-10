import {
  Button as RNPButton,
  ButtonProps as RNPButtonProps,
} from "react-native-paper";

import { useTheme } from "@/shared/theme";
import { withAlpha } from "@/shared/toolkit";

export interface ButtonProps extends RNPButtonProps {
  size?: "none" | "sm" | "md" | "lg";
}

export const Button = (props: ButtonProps) => {
  const {
    children,
    contentStyle,
    disabled,
    loading,
    mode = "contained",
    textColor,
    size = "md",
    style,
    ...rest
  } = props;

  const theme = useTheme();

  const SIZE = {
    none: { padding: 0 },
    sm: { padding: 4 },
    md: { padding: 8 },
    lg: { padding: 12 },
  } as const;

  const MODE = {
    outlined: {
      backgroundColor: theme.colors.primaryContainer,
      borderColor: withAlpha(theme.colors.primary, 0.1),
      borderWidth: 3,
    },
  } as const;

  return (
    <RNPButton
      disabled={disabled || loading}
      loading={loading}
      mode={mode}
      textColor={textColor}
      contentStyle={[SIZE[size], contentStyle]}
      style={[
        { borderRadius: 20 },
        MODE[mode as keyof typeof MODE],
        style,
        size === "none" && { right: -4 },
      ]}
      {...rest}
    >
      {children}
    </RNPButton>
  );
};
