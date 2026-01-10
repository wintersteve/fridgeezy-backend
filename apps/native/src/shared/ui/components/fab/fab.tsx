import { BlurView } from "expo-blur";
import * as Haptics from "expo-haptics";
import { Platform, Pressable, StyleSheet } from "react-native";
import { IconButton, Portal } from "react-native-paper";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

import { useTheme } from "@/shared/theme";

import { FabActionButton } from "./fab-action";
import { FabDivider } from "./fab-divider";

import type { FabAction, FabProps } from "./types";

type FabItem = { type: "action"; action: FabAction } | { type: "divider" };

const AnimatedBlurView = Animated.createAnimatedComponent(BlurView);

const SPRING_CONFIG = {
  damping: 15,
  stiffness: 150,
};

export function Fab({
  groups,
  icon = "plus",
  closeIcon = "close",
  color,
  backgroundColor,
  position = { bottom: 16, right: 16 },
  visible = true,
  onStateChange,
}: FabProps) {
  const theme = useTheme();
  const isExpanded = useSharedValue(0);

  const items: FabItem[] = groups.flatMap((group, groupIndex) => {
    const actionItems: FabItem[] = group.actions.map((action) => ({
      type: "action" as const,
      action,
    }));

    if (groupIndex < groups.length - 1) {
      return [...actionItems, { type: "divider" as const }];
    }

    return actionItems;
  });

  const mainButtonColor = color ?? theme.colors.primary;
  const mainButtonBg = backgroundColor ?? theme.colors.primaryContainer;

  const handleToggle = () => {
    const newValue = isExpanded.value === 0 ? 1 : 0;
    isExpanded.value = newValue;

    if (Platform.OS === "ios") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }

    onStateChange?.(newValue === 1);
  };

  const mainButtonAnimatedStyle = useAnimatedStyle(() => {
    const rotation = withSpring(
      interpolate(isExpanded.value, [0, 1], [0, 45], {
        extrapolateRight: Extrapolation.CLAMP,
      }),
      SPRING_CONFIG,
    );

    return {
      transform: [{ rotate: `${rotation}deg` }],
    };
  });

  const backdropAnimatedStyle = useAnimatedStyle(() => {
    return {
      opacity: isExpanded.value === 1 ? 1 : 0,
      pointerEvents:
        isExpanded.value === 1 ? ("auto" as const) : ("none" as const),
    };
  });

  const blurAnimatedProps = useAnimatedProps(() => {
    const intensity = withSpring(
      interpolate(isExpanded.value, [0, 1], [0, 50], {
        extrapolateRight: Extrapolation.CLAMP,
      }),
      SPRING_CONFIG,
    );

    return { intensity };
  });

  if (!visible) {
    return null;
  }

  return (
    <Portal>
      <Animated.View style={[styles.backdrop, backdropAnimatedStyle]}>
        <AnimatedBlurView
          animatedProps={blurAnimatedProps}
          style={StyleSheet.absoluteFill}
          tint="extraLight"
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={handleToggle} />
        </AnimatedBlurView>
      </Animated.View>

      <Animated.View style={[styles.container, position]}>
        {items.map((item, index) =>
          item.type === "action" ? (
            <FabActionButton
              key={`action-${index}`}
              action={item.action}
              index={index}
              isExpanded={isExpanded}
            />
          ) : (
            <FabDivider
              key={`divider-${index}`}
              index={index}
              isExpanded={isExpanded}
            />
          ),
        )}

        <Animated.View style={mainButtonAnimatedStyle}>
          <IconButton
            icon={isExpanded.value === 1 ? closeIcon : icon}
            iconColor={mainButtonColor}
            size={28}
            onPress={handleToggle}
            style={[styles.mainButton, { backgroundColor: mainButtonBg }]}
          />
        </Animated.View>
      </Animated.View>
    </Portal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject },
  container: {
    alignItems: "flex-end",
    position: "absolute",
    left: 0,
  },
  mainButton: {
    borderRadius: 28,
    elevation: 6,
    height: 56,
    margin: 0,
    shadowOffset: { height: 3, width: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    width: 56,
  },
});
