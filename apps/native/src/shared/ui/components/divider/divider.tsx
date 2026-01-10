import { DimensionValue, View, ViewStyle } from "react-native";

import { useTheme } from "@/shared/theme";

export interface DividerProps {
  color?: string;
  height?: number;
  width?: DimensionValue;
  style?: ViewStyle;
  variant?: "dashed" | "solid";
  borderRadius?: number;
  dashLength?: number;
  dashGap?: number;
}

export const Divider = (props: DividerProps) => {
  const {
    color,
    height: injectedHeight,
    width: injectedWidth,
    style,
    variant: injectedVariant,
    borderRadius: injectedBorderRadius,
    dashLength = 6,
    dashGap = 4,
  } = props;

  const { colors } = useTheme();

  const height = injectedHeight ?? 1;
  const width = injectedWidth ?? "100%";
  const variant = injectedVariant ?? "solid";
  const borderRadius = injectedBorderRadius ?? height / 2;
  const lineColor = color ?? colors.onBackground;

  if (variant === "solid") {
    return (
      <View
        style={[
          {
            height,
            width,
            backgroundColor: lineColor,
            borderRadius,
          },
          style,
        ]}
      />
    );
  }

  // dashed simulation
  return (
    <View
      style={[
        {
          flexDirection: "row",
          width,
          height,
          overflow: "hidden",
          alignItems: "center",
        },
        style,
      ]}
    >
      {Array.from({ length: 50 }).map((_, i) => (
        <View
          key={i}
          style={{
            width: dashLength,
            height,
            marginRight: dashGap,
            backgroundColor: lineColor,
            borderRadius,
          }}
        />
      ))}
    </View>
  );
};
