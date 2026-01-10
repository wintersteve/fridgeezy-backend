import { View } from "react-native";
import { Icon, Text } from "react-native-paper";

import { useTheme } from "@/shared/theme";

export interface InfoCardProps {
  icon: string;
  label: string;
  value: string;
  colors: ReturnType<typeof useTheme>["colors"];
}

export const InfoCard = (props: InfoCardProps) => {
  const { icon, label, value, colors } = props;

  return (
    <View
      style={{
        alignItems: "center",
        backgroundColor: "transparent",
        borderRadius: 12,
        gap: 8,
        paddingHorizontal: 16,
        paddingVertical: 12,
      }}
    >
      <Icon source={icon} size={24} color={colors.primary} />
      <View style={{ alignItems: "center" }}>
        <Text variant="titleSmall" style={{ color: colors.onSurfaceVariant }}>
          {value}
        </Text>
        <Text style={{ color: colors.onSurfaceVariant }} variant="bodySmall">
          {label}
        </Text>
      </View>
    </View>
  );
};
