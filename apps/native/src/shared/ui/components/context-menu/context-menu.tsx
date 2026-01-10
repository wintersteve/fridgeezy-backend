import { BlurView } from "expo-blur";
import React, { useState, useRef } from "react";
import {
  View,
  Pressable,
  StyleSheet,
  Dimensions,
  UIManager,
  findNodeHandle,
} from "react-native";
import { Icon, Portal, Text, useTheme } from "react-native-paper";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withDelay,
  interpolate,
  runOnJS,
} from "react-native-reanimated";

import { AnimatedPressable, Row } from "@/shared/ui";

export type ContextMenuAction = {
  id: string;
  icon: string;
  label: string;
  onPress: () => void;
};

export type ContextMenuProps = {
  children: React.ReactElement;
  actions: ContextMenuAction[];
  popupWidth?: number;
  verticalOffset?: number;
};

export const ContextMenu = (props: ContextMenuProps) => {
  const { children, actions, popupWidth = 200, verticalOffset = 6 } = props;

  const theme = useTheme();
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const [itemLayout, setItemLayout] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  const ref = useRef<View | null>(null);

  // Reanimated shared values
  const scale = useSharedValue(1);
  const shadowProgress = useSharedValue(0);
  const width = useSharedValue(0);
  const height = useSharedValue(0);
  const opacity = useSharedValue(0); // Menu fade in/out
  const backdropOpacity = useSharedValue(0); // Backdrop blur fade

  // Two spring configs for different feel
  const SPRING_CONFIG_BOUNCY = {
    damping: 12, // Lower damping = more bounce/overshoot
    stiffness: 200, // Medium stiffness for smooth bounce
  };

  const SPRING_CONFIG_SNAPPY = {
    damping: 18, // Higher damping = less overshoot
    stiffness: 300, // High stiffness for quick response
  };

  const open = () => {
    if (!ref.current) return;
    const handle = findNodeHandle(ref.current);
    if (!handle) return;

    UIManager.measureInWindow(handle, (x, y, triggerWidth, triggerHeight) => {
      const screenH = Dimensions.get("window").height;
      const estimatedH = actions.length * 48;
      const fitsBelow =
        y + triggerHeight + estimatedH + verticalOffset < screenH;
      const top = fitsBelow
        ? y + triggerHeight + verticalOffset
        : y - estimatedH - verticalOffset;

      setItemLayout({ x, y, width: triggerWidth, height: triggerHeight });
      setPosition({ top, left: x });
      setVisible(true);

      // Opening animations with cascade effect (following FAB pattern)

      // 1. Backdrop fades in first (creates depth)
      backdropOpacity.value = withSpring(1, SPRING_CONFIG_SNAPPY);

      // 2. Trigger clone scales with bounce (instant, exciting)
      scale.value = withSpring(1.02, SPRING_CONFIG_BOUNCY);
      shadowProgress.value = withSpring(1, SPRING_CONFIG_SNAPPY);

      // 3. Menu popup appears with 30ms stagger (delightful cascade)
      opacity.value = withDelay(30, withSpring(1, SPRING_CONFIG_BOUNCY));

      width.value = withDelay(30, withSpring(popupWidth, SPRING_CONFIG_BOUNCY));

      height.value = withDelay(
        30,
        withSpring(estimatedH, SPRING_CONFIG_BOUNCY),
      );
    });
  };

  const close = () => {
    // Closing animations - all simultaneous, fast and smooth

    // Scale down slightly (receding effect, not crushing)
    scale.value = withSpring(0.98, SPRING_CONFIG_SNAPPY);
    shadowProgress.value = withSpring(0, SPRING_CONFIG_SNAPPY);

    // Menu fades out while maintaining size
    opacity.value = withSpring(0, SPRING_CONFIG_SNAPPY, (finished) => {
      // Critical fix: Use runOnJS to safely update state
      // This prevents crashes if component unmounts during animation
      if (finished) {
        runOnJS(setVisible)(false);
      }
    });

    // Backdrop fades out
    backdropOpacity.value = withSpring(0, SPRING_CONFIG_SNAPPY);

    // Keep dimensions expanded (hidden by opacity fade)
    // No need to collapse to 0 - looks weird
  };

  // Animated styles for child clone (scale + shadow)
  const childAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    shadowOffset: {
      width: 0,
      height: interpolate(shadowProgress.value, [0, 1], [0, 4]),
    },
    shadowOpacity: interpolate(shadowProgress.value, [0, 1], [0, 0.05]),
    shadowRadius: interpolate(shadowProgress.value, [0, 1], [0, 8]),
    elevation: interpolate(shadowProgress.value, [0, 1], [0, 4]),
  }));

  // Animated styles for popup (dimensions + shadow + opacity)
  const popupAnimatedStyle = useAnimatedStyle(() => ({
    width: width.value,
    height: height.value,
    opacity: opacity.value, // NEW: Add opacity for fade in/out
    shadowOffset: {
      width: 0,
      height: interpolate(shadowProgress.value, [0, 1], [0, 4]),
    },
    shadowOpacity: interpolate(shadowProgress.value, [0, 1], [0, 0.05]),
    shadowRadius: interpolate(shadowProgress.value, [0, 1], [0, 8]),
    elevation: interpolate(shadowProgress.value, [0, 1], [0, 4]),
  }));

  // Animated styles for backdrop blur
  const backdropAnimatedStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));

  return (
    <>
      {/* Original Pressable hidden while popup clone is visible */}
      <Pressable
        ref={ref}
        onLongPress={open}
        delayLongPress={350}
        style={{ opacity: visible ? 0 : 1 }}
      >
        {children}
      </Pressable>

      <Portal>
        {visible && position && itemLayout && (
          <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
            {/* Blurred background with outside-close */}
            <Animated.View
              style={[StyleSheet.absoluteFill, backdropAnimatedStyle]}
            >
              <Pressable
                style={StyleSheet.absoluteFill}
                onPress={close}
                android_ripple={{ color: "transparent" }}
              >
                <BlurView
                  intensity={30}
                  tint="light"
                  style={StyleSheet.absoluteFill}
                />
              </Pressable>
            </Animated.View>

            {/* Animated clone of pressed child */}
            <Animated.View
              style={[
                {
                  position: "absolute",
                  top: itemLayout.y,
                  left: itemLayout.x,
                  width: itemLayout.width,
                  height: itemLayout.height,
                  shadowColor: theme.colors.onBackground,
                },
                childAnimatedStyle,
              ]}
              pointerEvents="none"
            >
              {children}
            </Animated.View>

            {/* Popup menu expanding from top-left */}
            <Animated.View
              style={[
                styles.popupContainer,
                {
                  shadowColor: theme.colors.onBackground,
                  top: position.top,
                  left: position.left,
                },
                popupAnimatedStyle,
              ]}
            >
              <View
                style={[
                  styles.popup,
                  {
                    backgroundColor: theme.colors.surface,
                    borderColor: theme.colors.outline,
                    flex: 1,
                  },
                ]}
              >
                {actions.map((action) => (
                  <AnimatedPressable
                    key={action.id}
                    onPress={() => {
                      action.onPress();
                      close();
                    }}
                    style={({ pressed }) => [
                      styles.action,
                      pressed && {
                        backgroundColor: theme.colors.surfaceVariant,
                      },
                    ]}
                  >
                    <Row centered spacing={12}>
                      <Icon source={action.icon} size={18} />
                      <Text>{action.label}</Text>
                    </Row>
                  </AnimatedPressable>
                ))}
              </View>
            </Animated.View>
          </View>
        )}
      </Portal>
    </>
  );
};

const styles = StyleSheet.create({
  action: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  popup: {
    borderRadius: 10,
    justifyContent: "center",
  },
  popupContainer: {
    elevation: 10,
    position: "absolute",
    zIndex: 1000, // clip content during animation
  },
});
