import React from "react";
import { View, StyleSheet } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
} from "react-native-reanimated";

import { useTheme } from "@/shared/theme";
import { withAlpha } from "@/shared/toolkit";

export interface SliderProps {
  min?: number;
  max?: number;
  step?: number;
  value?: number;
  onValueChange?: (value: number) => void;
  disabled?: boolean;
  showValue?: boolean;
  trackHeight?: number;
  thumbSize?: number;
  width?: number;
}

export const Slider = ({
  min = 0,
  max = 100,
  step = 1,
  value = min,
  onValueChange,
  disabled = false,
  showValue = true,
  trackHeight = 34,
  thumbSize = 24,
  width = 300,
}: SliderProps) => {
  const theme = useTheme();

  const MAX_OFFSET = width - thumbSize;

  const valueToOffset = (val: number) => {
    "worklet";
    const normalizedValue = Math.max(min, Math.min(max, val));
    return ((normalizedValue - min) / (max - min)) * MAX_OFFSET;
  };

  const offsetToValue = (offset: number) => {
    "worklet";
    const normalizedOffset = Math.max(0, Math.min(MAX_OFFSET, offset));
    const rawValue = (normalizedOffset / MAX_OFFSET) * (max - min) + min;
    return Math.round(rawValue / step) * step;
  };

  const offset = useSharedValue(valueToOffset(value));
  const currentValue = useSharedValue(value);

  const notifyValueChange = (newValue: number) => {
    if (onValueChange) {
      onValueChange(newValue);
    }
  };

  const panGesture = Gesture.Pan()
    .enabled(!disabled)
    .onChange((event) => {
      "worklet";
      const newOffset = Math.max(
        0,
        Math.min(MAX_OFFSET, offset.value + event.changeX),
      );
      offset.value = newOffset;

      const newValue = offsetToValue(newOffset);
      if (newValue !== currentValue.value) {
        currentValue.value = newValue;
        runOnJS(notifyValueChange)(newValue);
      }
    })
    .onEnd(() => {
      "worklet";
      const snappedValue = offsetToValue(offset.value);
      offset.value = withSpring(valueToOffset(snappedValue), {
        damping: 20,
        stiffness: 300,
      });
    });

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.value }],
  }));

  const activeTrackStyle = useAnimatedStyle(() => ({
    width: offset.value + thumbSize / 2,
  }));

  return (
    <View style={[styles.container, { width }]}>
      <View style={styles.sliderContainer}>
        <View
          style={[
            styles.track,
            {
              height: trackHeight,
              backgroundColor: theme.colors.surface,
              borderColor: withAlpha(theme.colors.surface, 0.1),
            },
          ]}
        >
          <Animated.View
            style={[
              styles.activeTrack,
              {
                height: trackHeight,
                backgroundColor: theme.colors.surface,
              },
              activeTrackStyle,
            ]}
          />
        </View>
        <GestureDetector gesture={panGesture}>
          <Animated.View
            style={[
              styles.thumb,
              {
                width: thumbSize,
                height: thumbSize,
                backgroundColor: theme.colors.primary,
                opacity: disabled ? 0.5 : 1,
              },
              thumbStyle,
            ]}
          />
        </GestureDetector>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingVertical: 8,
  },
  valueText: {
    textAlign: "center",
    marginBottom: 8,
    fontWeight: "600",
  },
  sliderContainer: {
    marginHorizontal: 6,
    position: "relative",
    justifyContent: "center",
  },
  track: {
    borderWidth: 1,
    borderRadius: 50,
    marginHorizontal: -6,
    overflow: "hidden",
  },
  activeTrack: {
    borderRadius: 2,
  },
  thumb: {
    position: "absolute",
    borderRadius: 100,
    elevation: 4,
  },
});
