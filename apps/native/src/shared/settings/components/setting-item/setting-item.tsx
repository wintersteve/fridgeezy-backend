import { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { Icon, Text } from "react-native-paper";

import { useTheme } from "@/shared/theme";
import { Row } from "@/shared/ui";

interface SettingItemProps {
  icon: string;
  title: string;
  onPress?: () => void;
  destructive?: boolean;
  right?: ReactNode;
}

export const SettingItem = (props: SettingItemProps) => {
  const { icon, title, onPress, destructive = false, right } = props;

  const { colors } = useTheme();

  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => ({
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Row
        centered
        spacing={12}
        style={{ paddingHorizontal: 16, paddingVertical: 12 }}
      >
        <View
          style={{
            backgroundColor: colors.primaryContainer,
            borderRadius: 100,
            padding: 10,
          }}
        >
          <Icon source={icon} size={14} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text
            variant="bodyMedium"
            style={{ color: destructive ? colors.error : colors.onSurface }}
          >
            {title}
          </Text>
        </View>
        <View>
          {right ? (
            right
          ) : (
            <Icon
              source="chevron-right"
              size={20}
              color={colors.onSurfaceVariant}
            />
          )}
        </View>
      </Row>
    </Pressable>
  );
};
