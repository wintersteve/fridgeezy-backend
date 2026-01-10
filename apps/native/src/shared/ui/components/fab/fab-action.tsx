import * as Haptics from "expo-haptics";
import { Platform, StyleSheet, View } from "react-native";
import { IconButton } from "react-native-paper";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  withDelay,
  withSpring,
} from "react-native-reanimated";

import { useTheme } from "@/shared/theme";
import { Row } from "@/shared/ui";

import type { FabAction } from "./types";

interface FabActionButtonProps {
  action: FabAction;
  index: number;
  isExpanded: Animated.SharedValue<number>;
}

const OFFSET = 70;
const SPRING_CONFIG = {
  damping: 15,
  stiffness: 150,
};

export function FabActionButton(props: FabActionButtonProps) {
  const { action, index, isExpanded } = props;

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
      transform: [{ translateY }, { scale }],
      opacity,
    };
  });

  const handlePress = () => {
    if (Platform.OS === "ios") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    action.onPress();
  };

  const backgroundColor = action.backgroundColor ?? theme.colors.surface;

  const iconColor = action.color ?? theme.colors.onSurface;

  return (
    <Animated.View
      style={[styles.actionContainer, animatedStyle, { backgroundColor }]}
    >
      <Row centered wrap={false}>
        <IconButton
          icon={action.icon}
          iconColor={iconColor}
          size={20}
          onPress={handlePress}
          style={styles.actionButton}
        />
        <View style={styles.contentContainer}>{action.content}</View>
      </Row>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  actionButton: {
    borderRadius: 28,
    height: 40,
    margin: 0,
    width: 40,
  },
  actionContainer: {
    alignItems: "center",
    bottom: 0,
    borderRadius: 12,
    flexDirection: "row",
    gap: 12,
    padding: 8,
    position: "absolute",
    right: 8,
    marginLeft: 24,
    paddingRight: 20,
    shadowRadius: 4,
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 4 },
  },
  contentContainer: {
    flexShrink: 1,
  },
});
