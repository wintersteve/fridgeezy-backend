import { useRouter } from "expo-router";
import { View } from "react-native";
import { Text } from "react-native-paper";
import Animated, { FadeInUp } from "react-native-reanimated";

import { usePantryItems, usePrompts } from "@/core/supabase";
import { useTheme } from "@/shared/theme";
import { Button, EmptyCard, ScrollView, Section } from "@/shared/ui";

import { PromptCard } from "./components/prompt-card";

const QUICK_PROMPTS = [
  {
    id: "pantry",
    icon: "basket-check",
    title: "Cook from my pantry",
    description: "Find recipes using ingredients you already have",
  },
  {
    id: "quick",
    icon: "clock-fast",
    title: "Quick 15-minute meals",
    description: "Fast recipes when you're short on time",
  },
  {
    id: "healthy",
    icon: "leaf",
    title: "Healthy dinner ideas",
    description: "Nutritious recipes for a balanced meal",
  },
  {
    id: "budget",
    icon: "piggy-bank",
    title: "Budget-friendly meals",
    description: "Delicious recipes that won't break the bank",
  },
];

export const SuggestTab = () => {
  const { colors } = useTheme();

  const router = useRouter();

  const pantryItems = usePantryItems();

  const prompts = usePrompts();

  const handleCreatePromptPress = () => {
    router.push("/settings/prompt-create");
  };

  const handlePromptPress = (promptId: string) => {
    const pantryIngredients = (pantryItems.data ?? [])
      .map((item) => item.ingredient?.name?.toLowerCase())
      .filter(Boolean) as string[];

    switch (promptId) {
      case "pantry":
        if (pantryIngredients.length > 0) {
          const params = encodeURIComponent(
            pantryIngredients.slice(0, 5).join(","),
          );
          router.push(`/recipes/search?ingredients=${params}`);
        } else {
          router.push("/ingredients");
        }
        break;
      case "quick":
        router.push("/recipes/search?ingredients=quick,easy,simple");
        break;
      case "healthy":
        router.push("/recipes/search?ingredients=healthy,vegetables,lean");
        break;
      case "budget":
        router.push("/recipes/search?ingredients=rice,beans,eggs,pasta");
        break;
    }
  };

  const handleCustomPromptPress = (id: string) => {
    router.push(`/prompts/${id}`);
  };

  return (
    <ScrollView>
      {/* Quick Prompts */}
      <Animated.View entering={FadeInUp.delay(50).duration(400).springify()}>
        <Section
          right={
            <Button
              icon="creation"
              mode="text"
              onPress={handleCreatePromptPress}
            >
              Create
            </Button>
          }
          title={
            <Text
              variant="headlineSmall"
              style={{ color: colors.onBackgroundVariant }}
            >
              Saved Prompts
            </Text>
          }
          titleStyle={{ paddingLeft: 18 }}
          style={{ marginTop: 12 }}
        >
          <View style={{ marginHorizontal: 12 }}>
            {!!prompts.data?.length ? (
              prompts.data?.map((prompt, index) => (
                <PromptCard
                  key={prompt.id}
                  index={index + 1}
                  icon="heart-outline"
                  title={`Prompt ${index + 1}`}
                  description={prompt.prompt}
                  onPress={() => handleCustomPromptPress(prompt.id)}
                />
              ))
            ) : (
              <EmptyCard
                title="Empty"
                description="You don't have any prompts at the moment."
              />
            )}
          </View>
        </Section>
      </Animated.View>

      {/* Quick Prompts */}
      <Animated.View entering={FadeInUp.delay(150).duration(400).springify()}>
        <Section
          title={
            <Text
              variant="headlineSmall"
              style={{ color: colors.onBackgroundVariant }}
            >
              Quick Prompts
            </Text>
          }
          titleStyle={{ paddingHorizontal: 18, marginTop: 24 }}
        >
          <View style={{ marginHorizontal: 12 }}>
            {QUICK_PROMPTS.map((prompt, index) => (
              <PromptCard
                key={prompt.id}
                index={index + 1}
                icon={prompt.icon}
                title={prompt.title}
                description={prompt.description}
                onPress={() => handlePromptPress(prompt.id)}
              />
            ))}
          </View>
        </Section>
      </Animated.View>
    </ScrollView>
  );
};
