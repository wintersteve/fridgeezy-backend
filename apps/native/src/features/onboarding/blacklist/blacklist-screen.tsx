import { useRouter } from "expo-router";
import { View } from "react-native";
import { Text } from "react-native-paper";

import { AuthLayout } from "@/features/auth";
import { useIngredientsFilterStore } from "@/features/ingredients";
import { useTags } from "@/shared/supabase";
import { useTheme } from "@/shared/theme";
import { titleCase } from "@/shared/toolkit";
import { Button, Card, Chip, Row, ScrollView, Skeleton } from "@/shared/ui";

const SKELETON_WIDTHS = [80, 70, 70, 90, 85, 100, 75, 95, 70, 90, 100, 74];

export const BlacklistScreen = () => {
  const filterStore = useIngredientsFilterStore();

  const theme = useTheme();

  const tags = useTags("dietary");

  const router = useRouter();

  const handleContinue = async () => {
    router.push("/(onboarding)/skill");
  };

  return (
    <AuthLayout
      button={<Button onPress={handleContinue}>Continue</Button>}
      description="Tell us how you hate so we can recommend recipes that fit your
          lifestyle.
"
    >
      <View style={{ flex: 1, paddingHorizontal: 12 }}>
        <ScrollView style={{ flex: 1 }}>
          <Text
            variant="headlineMedium"
            style={{
              color: theme.colors.onBackgroundVariant,
              marginLeft: 6,
              marginBottom: 4,
            }}
          >
            {filterStore.restrictions.length} Selected
          </Text>
          <Card contentStyle={{ padding: 12 }}>
            <Row spacing={6}>
              {tags.isLoading
                ? SKELETON_WIDTHS.map((width, index) => (
                    <Skeleton key={index} width={width} height={32} />
                  ))
                : (tags.data?.map((item) => item.name) ?? []).map((id) => (
                    <Chip
                      key={id}
                      onPress={() => {
                        filterStore.setRestrictions(
                          filterStore.restrictions.includes(id)
                            ? filterStore.restrictions.filter(
                                (item) => item !== id,
                              )
                            : [...filterStore.restrictions, id],
                        );
                      }}
                      selected={filterStore.restrictions.includes(id)}
                    >
                      {titleCase(id)}
                    </Chip>
                  ))}
            </Row>
          </Card>
        </ScrollView>
      </View>
    </AuthLayout>
  );
};
