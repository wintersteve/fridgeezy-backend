import { Link as ERLink, LinkProps as ERLinkProps } from "expo-router";
import { TextStyle, TouchableOpacity } from "react-native";

import { useTheme } from "@/shared/theme";

export interface LinkProps extends Omit<ERLinkProps, "style"> {
  mode?: "transparent" | "contained";
  style?: TextStyle;
}

export const Link = (props: LinkProps) => {
  const { children, mode = "transparent", style, ...rest } = props;

  const { colors } = useTheme();

  return (
    <ERLink
      {...rest}
      asChild
      style={[
        style,
        mode === "contained" && {
          backgroundColor: colors.secondaryContainer,
          borderRadius: 50,
          borderColor: colors.secondary,
          borderWidth: 5,
          paddingHorizontal: children ? 20 : 8,
          paddingVertical: 8,
        },
      ]}
    >
      <TouchableOpacity>{children}</TouchableOpacity>
    </ERLink>
  );
};
