import { ReactNode } from "react";
import { StyleProp, View, ViewStyle } from "react-native";
import { Text } from "react-native-paper";

import { useTheme } from "@/shared/theme";

export interface HeadlineProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}

export const Headline = (props: HeadlineProps) => {
  const { children, style } = props;

  const { colors } = useTheme();

  return (
    <View
      style={[
        { alignSelf: "flex-start", borderRadius: 6, marginHorizontal: 1 },
        style,
      ]}
    >
      <Text
        variant="titleMedium"
        style={{ color: colors.onBackground, marginHorizontal: 2 }}
      >
        {children}
      </Text>
    </View>
  );
};
