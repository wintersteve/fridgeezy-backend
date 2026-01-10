import { useState } from "react";
import { View } from "react-native";
import { Badge, Icon, Text } from "react-native-paper";

import { useTheme } from "@/shared/theme";
import { Button, Card, Row } from "@/shared/ui";

interface TipCardProps {
  tips: string[];
}

export const TipCard = ({ tips }: TipCardProps) => {
  const [expanded, setExpanded] = useState(false);
  const { colors } = useTheme();

  return (
    <Card
      style={{ backgroundColor: colors.primaryContainer }}
      contentStyle={{ padding: 20 }}
    >
      {/* Header with icon + title + badge */}
      <Row spacing={12} style={{ marginBottom: 20, alignItems: "center" }}>
        <Icon source="lightbulb-on" size={24} color={colors.primary} />
        <Text variant="titleMedium" style={{ color: colors.primary }}>
          Pro Tips
        </Text>
        <Badge style={{ backgroundColor: colors.primary }}>{tips.length}</Badge>
      </Row>

      {/* Preview or Full List */}
      {!expanded ? (
        <>
          <Text
            variant="bodyMedium"
            style={{ marginBottom: 12, color: colors.onSurfaceVariant }}
          >
            {tips[0]}
          </Text>
          {tips.length > 1 && (
            <Button
              mode="text"
              onPress={() => setExpanded(true)}
              icon="chevron-down"
              style={{ alignSelf: "flex-start" }}
            >
              Show all {tips.length} tips
            </Button>
          )}
        </>
      ) : (
        <>
          <View style={{ gap: 12, marginBottom: 12 }}>
            {tips.map((tip, index) => (
              <Row
                key={index}
                spacing={8}
                wrap={false}
                style={{ alignItems: "flex-start" }}
              >
                <Icon source="check-circle" size={20} color={colors.primary} />
                <Text
                  variant="bodyMedium"
                  style={{ flex: 1, color: colors.onSurface }}
                >
                  {tip}
                </Text>
              </Row>
            ))}
          </View>
          <Button
            mode="text"
            onPress={() => setExpanded(false)}
            icon="chevron-up"
            style={{ alignSelf: "flex-start" }}
          >
            Show less
          </Button>
        </>
      )}
    </Card>
  );
};
