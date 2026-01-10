import { ReactNode } from "react";
import {
  Animated,
  GestureResponderEvent,
  GestureResponderHandlers,
  PanResponder,
  PanResponderGestureState,
  StyleProp,
  View,
  ViewStyle,
} from "react-native";

export type SwipeGestureDirection = "up" | "down" | "left" | "right";

export interface SwipeGestureProps {
  onSwipe: (direction: SwipeGestureDirection) => void;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}

export const SwipeGesture = (props: SwipeGestureProps) => {
  const { onSwipe, style, children } = props;

  const panResponder = PanResponder.create({
    // Allow PanResponder only if it's not a vertical scroll (e.g., dx is significant)
    onMoveShouldSetPanResponder: (_, gestureState) =>
      Math.abs(gestureState.dx) > Math.abs(gestureState.dy),
    onPanResponderRelease: (
      _: GestureResponderEvent,
      gestureState: PanResponderGestureState,
    ) => {
      const { dx, dy } = gestureState;
      if (Math.abs(dx) > Math.abs(dy)) {
        if (dx >= 30) {
          onSwipe("right");
        } else if (dx <= -30) {
          onSwipe("left");
        }
      } else {
        if (dy >= 0) {
          onSwipe("down");
        } else {
          onSwipe("up");
        }
      }
    },
  });

  return (
    <Animated.View
      {...(panResponder.panHandlers as GestureResponderHandlers)}
      style={[style, { flexShrink: 1 }]}
    >
      <View>{children}</View>
    </Animated.View>
  );
};
