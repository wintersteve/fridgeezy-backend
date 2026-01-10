import * as Haptics from "expo-haptics";
import { ReactNode } from "react";
import { Platform, Pressable, PressableProps } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

const AnimatedPressableBase = Animated.createAnimatedComponent(Pressable);

interface AnimatedPressableProps extends PressableProps {
  children: ReactNode;
  scaleValue?: number;
  enableHaptics?: boolean;
}

export function AnimatedPressable({
  children,
  scaleValue = 0.97,
  enableHaptics = true,
  onPressIn,
  onPressOut,
  style,
  ...props
}: AnimatedPressableProps) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = (
    event: Parameters<NonNullable<PressableProps["onPressIn"]>>[0],
  ) => {
    scale.value = withSpring(scaleValue, { damping: 15, stiffness: 300 });
    if (enableHaptics && Platform.OS === "ios") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    onPressIn?.(event);
  };

  const handlePressOut = (
    event: Parameters<NonNullable<PressableProps["onPressOut"]>>[0],
  ) => {
    scale.value = withSpring(1, { damping: 15, stiffness: 300 });
    onPressOut?.(event);
  };

  return (
    <AnimatedPressableBase
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[animatedStyle, style]}
      {...props}
    >
      {children}
    </AnimatedPressableBase>
  );
}
