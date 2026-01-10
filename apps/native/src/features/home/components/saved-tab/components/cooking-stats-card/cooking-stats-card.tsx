import { StyleSheet, View } from "react-native";
import { Icon, Text } from "react-native-paper";

import { useTheme } from "@/shared/theme";
import { Card, Row } from "@/shared/ui";

import { useCookingStats } from "../../../../hooks/use-cooking-stats";

export const CookingStatsCard = () => {
  const { colors } = useTheme();
  const stats = useCookingStats();

  return (
    <Card
      style={styles.card}
      contentStyle={{
        paddingHorizontal: 12,
        paddingVertical: 32,
      }}
    >
      <Row style={{ justifyContent: "space-around" }}>
        <View style={styles.statItem}>
          <Icon source="check-bold" size={24} color={colors.primary} />
          <Text variant="headlineMedium" style={{ color: colors.onSurface }}>
            {stats.totalCooked}
          </Text>
          <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
            Cooked
          </Text>
        </View>
        <View style={styles.statItem}>
          <Icon source="heart" size={24} color={colors.error} />
          <Text variant="headlineMedium" style={{ color: colors.onSurface }}>
            {stats.totalFavorites}
          </Text>
          <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
            Favorites
          </Text>
        </View>
        <View style={styles.statItem}>
          <Icon source="folder-heart" size={24} color={colors.tertiary} />
          <Text variant="headlineMedium" style={{ color: colors.onSurface }}>
            {stats.totalCollections}
          </Text>
          <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
            Collections
          </Text>
        </View>
      </Row>
    </Card>
  );
};

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 12,
    marginTop: 8,
  },
  statItem: {
    alignItems: "center",
    gap: 4,
  },
});
