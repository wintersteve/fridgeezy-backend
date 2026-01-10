import { ReactNode } from "react";
import { View, ViewStyle } from "react-native";
import { Icon, Text } from "react-native-paper";

import { useTheme } from "@/shared/theme";
import { Card } from "@/shared/ui";

export interface EmptyCardProps {
  action?: ReactNode;
  leftAligned?: boolean;
  icon?: string;
  title?: string;
  description?: string;
  style?: ViewStyle;
}

export const EmptyCard = (props: EmptyCardProps) => {
  const {
    action,
    leftAligned = false,
    icon = "close-thick",
    title = "Empty",
    description,
    style,
  } = props;

  const { colors } = useTheme();

  return (
    <Card contentStyle={{ padding: leftAligned ? 20 : 48 }} style={style}>
      <View
        style={{ alignItems: leftAligned ? "flex-start" : "center", gap: 8 }}
      >
        <Icon source={icon} size={48} color={colors.error} />
        <View style={{ gap: 4 }}>
          <Text
            variant="titleMedium"
            style={{
              color: colors.onSurfaceVariant,
              textAlign: leftAligned ? "left" : "center",
            }}
          >
            {title}
          </Text>
          {description && (
            <Text
              variant="bodySmall"
              style={{
                color: colors.onBackgroundVariant,
                textAlign: leftAligned ? "left" : "center",
              }}
            >
              {description}
            </Text>
          )}
          {action}
        </View>
      </View>
    </Card>
  );
};
