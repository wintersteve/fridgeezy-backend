import { ReactNode } from "react";
import {
  GestureResponderEvent,
  StyleSheet,
  View,
  ViewStyle,
} from "react-native";
import {
  Chip as RNPChip,
  ChipProps as RNPChipProps,
  Icon,
  Text,
} from "react-native-paper";

import { useTheme } from "@/shared/theme";
import { withAlpha } from "@/shared/toolkit";

export interface ChipProps extends Pick<RNPChipProps, "mode"> {
  borderRadius?: number;
  children: ReactNode;
  color?: string;
  disabled?: boolean;
  icon?: string;
  selected?: boolean | number;
  readonly?: boolean;
  onPress?: (event: GestureResponderEvent) => void;
  onClose?: () => void;
  style?: ViewStyle;
}

export const Chip = (props: ChipProps) => {
  const {
    borderRadius = 100,
    color: injectedColor,
    children,
    disabled = false,
    readonly = false,
    selected = false,
    onPress,
    onClose,
    icon = "check-bold",
    mode = "flat",
    style,
  } = props;

  const isMultiSelect = typeof selected === "number";

  const isSelected = Boolean(selected);

  const { colors } = useTheme();

  const color = injectedColor ?? colors.secondary;

  return (
    <RNPChip
      disabled={disabled}
      mode={mode}
      selected={isSelected && !isMultiSelect}
      selectedColor={color}
      showSelectedCheck={false}
      showSelectedOverlay={false}
      onPress={readonly ? undefined : onPress}
      onClose={onClose}
      style={[
        { borderRadius, minHeight: 34 },
        !onPress && !onClose && { pointerEvents: "none" },
        style,
      ]}
      textStyle={[styles.text]}
      theme={{
        colors: {
          secondaryContainer: injectedColor
            ? withAlpha(color, 0.1)
            : colors.secondaryContainer,
        },
      }}
    >
      {!isMultiSelect && selected && (
        <View style={styles.icon}>
          <Icon
            color={disabled ? colors.surfaceDisabled : colors.secondary}
            size={14}
            source={icon}
          />
        </View>
      )}
      {children}
      {isMultiSelect && (
        <>
          {"  "}
          <View
            style={[
              styles.badge,
              {
                backgroundColor: disabled
                  ? colors.onSurfaceDisabled
                  : colors.secondary,
              },
            ]}
          >
            <Text variant="labelSmall" style={{ color: colors.surfaceVariant }}>
              {selected}
            </Text>
          </View>
        </>
      )}
    </RNPChip>
  );
};

const styles = StyleSheet.create({
  badge: {
    borderRadius: 2,
    paddingHorizontal: 4,
    paddingLeft: 5,
    transform: [{ translateY: 8 }],
  },
  icon: {
    position: "absolute",
    transform: [{ translateY: 3.5 }, { translateX: -6 }],
  },
  text: { fontSize: 10, textAlign: "center" },
});
