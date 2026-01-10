import { useRouter } from "expo-router";
import { View } from "react-native";
import { Icon, Text } from "react-native-paper";

import { CollectionWithRecipeCount } from "@/core/supabase";
import { useTheme } from "@/shared/theme";
import { AnimatedPressable, Card, Row } from "@/shared/ui";

interface CollectionCardProps {
  collection: CollectionWithRecipeCount;
}

export const CollectionCard = ({ collection }: CollectionCardProps) => {
  const { colors } = useTheme();
  const router = useRouter();

  const handlePress = () => {
    router.push(`/collections/${collection.id}`);
  };

  return (
    <AnimatedPressable onPress={handlePress}>
      <Card contentStyle={{ padding: 20 }}>
        <Row centered spacing={12}>
          <View
            style={{
              backgroundColor: colors.primaryContainer,
              borderRadius: 100,
              padding: 6,
            }}
          >
            <Icon source="folder" size={14} color={colors.primary} />
          </View>
          <View>
            <Text
              variant="titleSmall"
              numberOfLines={1}
              style={{ color: colors.onSurface }}
            >
              {collection.title}
            </Text>
            <Text
              variant="bodySmall"
              style={{ color: colors.onSurfaceVariant }}
            >
              {collection.recipeCount} Recipes
            </Text>
          </View>
        </Row>
      </Card>
    </AnimatedPressable>
  );
};
