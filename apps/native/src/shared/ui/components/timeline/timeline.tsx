import { MaterialCommunityIcons } from "@expo/vector-icons";
import { View } from "react-native";
import { Text } from "react-native-paper";

import { useTheme } from "@/shared/theme";
import { Card, Row } from "@/shared/ui";

const getSubscriptionDate = () => {
  const today = new Date();

  const twoWeeksLater = new Date(today);

  twoWeeksLater.setDate(today.getDate() + 14);

  return twoWeeksLater.toLocaleDateString();
};

export const Timeline = () => {
  const { colors } = useTheme();

  const items = [
    {
      icon: "lock",
      title: "Today",
      description:
        "Unlock all premium features for free and explore exclusive recipes, personalized meal plans, and more.",
      active: true,
    },
    {
      icon: "bell",
      title: "In 12 days",
      description: "We’ll send you a reminder that your trial is ending soon.",
    },
    {
      icon: "star",
      title: "In 14 days",
      description: `You’ll be charged on ${getSubscriptionDate()}, cancel anytime before.`,
    },
  ];

  return (
    <View>
      {items.map((item, index) => (
        <Row key={index} wrap={false}>
          <View
            style={{
              alignItems: "center",
              width: 40,
              marginRight: 8,
              top: 10,
            }}
          >
            <View
              style={{
                alignItems: "center",
                backgroundColor: colors.primaryContainer,
                borderColor: colors.primary,
                borderRadius: 20,
                borderWidth: 2,
                height: 36,
                justifyContent: "center",
                width: 36,
              }}
            >
              <MaterialCommunityIcons
                name={item.icon as any}
                size={14}
                color={colors.primary}
              />
            </View>
            {/* Bottom line */}
            {index < items.length - 1 && (
              <View
                style={{
                  width: 2,
                  flex: 1,
                  backgroundColor: colors.primary,
                }}
              />
            )}
          </View>

          {/* Text content */}
          <Card
            contentStyle={{ padding: 20 }}
            style={{ flexShrink: 1, marginBottom: 8 }}
          >
            <Text variant="titleMedium">{item.title}</Text>
            <Text
              variant="bodyMedium"
              style={{
                color: colors.onSurfaceVariant,
                marginRight: 24,
                marginTop: 6,
              }}
            >
              {item.description}
            </Text>
          </Card>
        </Row>
      ))}
    </View>
  );
};
