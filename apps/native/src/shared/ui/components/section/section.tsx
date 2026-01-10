import { ReactNode } from "react";
import { StyleProp, View, ViewStyle } from "react-native";
import { Text } from "react-native-paper";

import { useTheme } from "@/shared/theme";

import { Row } from "../row";

export interface SectionProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  right?: ReactNode;
  title: ReactNode;
  titleStyle?: StyleProp<ViewStyle>;
}

export const Section = (props: SectionProps) => {
  const { children, right, style, title, titleStyle } = props;

  const theme = useTheme();

  return (
    <View style={[{ flexGrow: 1 }, style]}>
      <Row between centered style={titleStyle} spacing={0}>
        <Text
          variant="headlineSmall"
          style={{
            color: theme.colors.onBackgroundVariant,
            marginLeft: 6,
            marginBottom: 14,
          }}
        >
          {title}
        </Text>
        <View style={{ marginRight: 4 }}>{right}</View>
      </Row>
      <View style={{ flex: 1 }}>{children}</View>
    </View>
  );
};
