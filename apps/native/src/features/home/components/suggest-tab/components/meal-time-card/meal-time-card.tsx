import { StyleSheet, View } from "react-native";
import { Icon, Text } from "react-native-paper";

import { useTheme } from "@/shared/theme";
import { AnimatedPressable, Card } from "@/shared/ui";

interface MealTimeCardProps {
  icon: string;
  title: string;
  isActive?: boolean;
  onPress: () => void;
}

export const MealTimeCard = ({
  icon,
  title,
  isActive,
  onPress,
}: MealTimeCardProps) => {
  const { colors } = useTheme();

  return (
    <AnimatedPressable onPress={onPress} style={styles.wrapper}>
      <Card
        borderColor={isActive ? colors.primary : undefined}
        style={styles.card}
        contentStyle={styles.content}
      >
        <View
          style={[
            styles.iconContainer,
            {
              backgroundColor: isActive
                ? colors.primaryContainer
                : colors.surfaceVariant,
            },
          ]}
        >
          <Icon
            source={icon}
            size={24}
            color={isActive ? colors.primary : colors.onSurfaceVariant}
          />
        </View>
        <Text
          variant="labelMedium"
          style={{ color: isActive ? colors.primary : colors.onSurfaceVariant }}
        >
          {title}
        </Text>
      </Card>
    </AnimatedPressable>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
  },
  card: {
    borderColor: "transparent",
    borderWidth: 2,
    flex: 1,
  },
  content: {
    alignItems: "center",
    padding: 12,
    gap: 8,
    minWidth: 92,
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
});
