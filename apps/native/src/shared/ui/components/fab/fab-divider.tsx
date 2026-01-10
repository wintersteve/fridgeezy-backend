import { StyleSheet } from "react-native";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  withDelay,
  withSpring,
} from "react-native-reanimated";

import { useTheme } from "@/shared/theme";

interface FabDividerProps {
  index: number;
  isExpanded: Animated.SharedValue<number>;
}

const OFFSET = 70;
const SPRING_CONFIG = {
  damping: 15,
  stiffness: 150,
};

export function FabDivider({ index, isExpanded }: FabDividerProps) {
  const theme = useTheme();

  const animatedStyle = useAnimatedStyle(() => {
    const delay = index * 10;

    const translateY = withDelay(
      delay,
      withSpring(
        interpolate(isExpanded.value, [0, 1], [0, -OFFSET * (index + 1)], {
          extrapolateRight: Extrapolation.CLAMP,
        }),
        SPRING_CONFIG,
      ),
    );

    const scale = withDelay(
      delay,
      withSpring(
        interpolate(isExpanded.value, [0, 1], [0, 1], {
          extrapolateRight: Extrapolation.CLAMP,
        }),
        SPRING_CONFIG,
      ),
    );

    const opacity = withDelay(
      delay,
      withSpring(
        interpolate(isExpanded.value, [0, 1], [0, 1], {
          extrapolateRight: Extrapolation.CLAMP,
        }),
        SPRING_CONFIG,
      ),
    );

    return {
      opacity,
      transform: [{ translateY }, { scale }],
    };
  });

  return (
    <Animated.View
      style={[
        styles.container,
        animatedStyle,
        { backgroundColor: theme.colors.surface },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    bottom: 0,
    height: 0,
    position: "absolute",
    right: 8,
    width: "90%",
  },
});
