import { useEffect, useRef } from "react";
import { Animated, ViewStyle } from "react-native";

import { useTheme } from "@/shared/theme";

interface SkeletonProps extends Pick<ViewStyle, "height" | "width"> {
  borderRadius?: number;
  style?: ViewStyle;
}

export const Skeleton = (props: SkeletonProps) => {
  const { width = "100%", height = 20, borderRadius = 16, style } = props;

  const { colors } = useTheme();

  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.3,
          duration: 800,
          useNativeDriver: true,
        }),
      ]),
    ).start();
  }, [opacity]);

  return (
    <Animated.View
      style={[
        {
          backgroundColor: colors.surfaceDisabled,
          opacity,
          width,
          height,
          borderRadius,
        },
        style,
      ]}
    />
  );
};
