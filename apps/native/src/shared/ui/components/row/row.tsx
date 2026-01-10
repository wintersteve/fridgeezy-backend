import { ReactNode } from "react";
import { View, StyleProp, ViewStyle } from "react-native";

export interface RowProps {
  between?: boolean;
  centered?: boolean;
  children: ReactNode;
  spacing?: number;
  style?: StyleProp<ViewStyle>;
  wrap?: boolean;
}

export const Row = (props: RowProps) => {
  const {
    between,
    centered = false,
    children,
    spacing = 0,
    style,
    wrap = true,
  } = props;

  return (
    <View
      style={[
        {
          alignItems: centered ? "center" : "flex-start",
          flexDirection: "row",
          flexWrap: wrap ? "wrap" : "nowrap",
          gap: spacing,
          justifyContent: between ? "space-between" : "flex-start",
        },
        style,
      ]}
    >
      {children}
    </View>
  );
};
