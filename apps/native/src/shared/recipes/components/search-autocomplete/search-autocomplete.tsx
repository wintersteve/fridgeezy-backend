import { useRouter } from "expo-router";
import { useState } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  SafeAreaView,
  StyleSheet,
  View,
} from "react-native";
import { Icon, IconButton, Text } from "react-native-paper";

import { PromptCard } from "@/features/home/components/suggest-tab/components/prompt-card";
import { useSearchRecipes } from "@/shared/supabase";
import { useTheme } from "@/shared/theme";
import { titleCase, useDebounce } from "@/shared/toolkit";
import {
  AnimatedPressable,
  Card,
  Chip,
  EmptyCard,
  Row,
  ScrollView,
  Section,
  Skeleton,
} from "@/shared/ui";

import { RecipeTextInput } from "../recipe-text-input";

interface SearchAutocompleteProps {
  visible?: boolean;
  onDismiss?: () => void;
}

export const SearchAutocomplete = ({
  visible,
  onDismiss,
}: SearchAutocompleteProps) => {
  const { colors } = useTheme();

  const router = useRouter();

  const [query, setQuery] = useState("");

  const [internalVisible, setInternalVisible] = useState(false);

  const [searchResults, setSearchResults] = useState<
    { id: string; name: string }[]
  >([]);

  const searchRecipes = useSearchRecipes();

  const { debounce } = useDebounce(500);

  const isControlled = visible !== undefined;

  const modalVisible = isControlled ? visible : internalVisible;

  const handleCancelPress = () => {
    Keyboard.dismiss();
    if (isControlled) {
      onDismiss?.();
    } else {
      setInternalVisible(false);
    }
  };

  const handleSuggestionPress = (query: string) => {
    router.push(`/recipes/search?query=${encodeURIComponent(query)}`);
    handleCancelPress();
  };

  const handleSearch = async (text: string) => {
    if (!text.trim()) {
      setSearchResults([]);
      return;
    }

    try {
      const data = await searchRecipes.mutateAsync(text);
      console.log(data);
      setSearchResults(data || []);
    } catch (err) {
      console.error("Search error:", err);
      setSearchResults([]);
    }
  };

  const handleRecipePress = (id: string) => {
    router.push(`/recipes/${id}`);
    handleCancelPress();
  };

  return (
    <View>
      <View
        style={{ backgroundColor: colors.primaryContainer, borderRadius: 100 }}
      >
        <IconButton
          icon="magnify"
          iconColor={colors.primary}
          onPress={() => setInternalVisible(true)}
          style={{ margin: 0 }}
        />
      </View>

      <Modal
        visible={modalVisible}
        animationType="slide"
        onRequestClose={handleCancelPress}
      >
        <SafeAreaView
          style={[
            styles.modalContainer,
            { backgroundColor: colors.background },
          ]}
        >
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior="padding"
            keyboardVerticalOffset={0}
          >
            <Row between centered style={styles.header} spacing={8}>
              <IconButton
                mode="outlined"
                icon="chevron-left"
                iconColor={colors.primary}
                style={{ backgroundColor: colors.primaryContainer }}
                onPress={handleCancelPress}
              />
              <RecipeTextInput
                autoFocus
                onSubmit={handleCancelPress}
                onChangeText={(text) => {
                  setQuery(text);
                  if (!text.trim()) {
                    setSearchResults([]);
                  } else if (text.length > 2) {
                    debounce(handleSearch, text);
                  }
                }}
                value={query}
              />
            </Row>

            <ScrollView keyboardShouldPersistTaps="always">
              {!!query && (
                <Section
                  title="Search Results"
                  style={{ gap: 8, marginHorizontal: 12, marginTop: 20 }}
                >
                  {searchRecipes.isPending && (
                    <View style={{ gap: 6 }}>
                      {[1].map((index) => (
                        <Card key={index} contentStyle={{ padding: 18 }}>
                          <View style={{ gap: 8 }}>
                            <Skeleton borderRadius={6} height={24} />
                          </View>
                        </Card>
                      ))}
                    </View>
                  )}
                  {!searchRecipes.isPending && searchResults.length <= 0 && (
                    <EmptyCard description="We couldn't find any matches. Adjust your search" />
                  )}
                  {!searchRecipes.isPending &&
                    searchResults.length > 0 &&
                    searchResults.map((recipe) => (
                      <AnimatedPressable
                        key={recipe.id}
                        onPress={() => handleRecipePress(recipe.id)}
                      >
                        <Card contentStyle={{ padding: 20 }}>
                          <Row centered spacing={8}>
                            <Icon
                              color={colors.onSurfaceVariant}
                              source="card"
                              size={20}
                            />
                            <Text variant="titleSmall">{recipe.name}</Text>
                          </Row>
                        </Card>
                      </AnimatedPressable>
                    ))}
                </Section>
              )}

              <Section
                title="Suggestions"
                style={{ gap: 4, marginHorizontal: 12, marginTop: 20 }}
              >
                <Card contentStyle={{ padding: 14 }}>
                  <Row spacing={4}>
                    {[
                      "pasta",
                      "pizza",
                      "chicken curry",
                      "tacos",
                      "burger",
                      "mac and cheese",
                      "ramen",
                      "sushi",
                      "steak",
                      "falafel",
                      "butter chicken",
                      "beef stew",
                      "biryani",
                      "meatballs",
                      "shawarma",
                      "pho",
                      "carbonara",
                      "bibimbap",
                    ].map((suggestion) => (
                      <Chip
                        key={suggestion}
                        onPress={() => handleSuggestionPress(suggestion)}
                      >
                        {titleCase(suggestion)}
                      </Chip>
                    ))}
                  </Row>
                </Card>
              </Section>

              <Section
                title="Popular Searches"
                style={{ gap: 4, marginHorizontal: 12, marginTop: 20 }}
              >
                <View style={{}}>
                  {[
                    {
                      title: "Cook from your pantry",
                      description:
                        "What can I cook with the ingredients I have at home?",
                    },
                    {
                      title: "Storage tips",
                      description: "What's the best way to store [ingredient]?",
                    },
                    {
                      title: "Perfect timing",
                      description:
                        "How do I know when [dish] is perfectly cooked?",
                    },
                  ].map((suggestion, index) => (
                    <PromptCard
                      key={suggestion.title}
                      index={index + 1}
                      icon="trending-up"
                      title={suggestion.title}
                      description={suggestion.description}
                      onPress={() =>
                        handleSuggestionPress(suggestion.description)
                      }
                    />
                  ))}
                </View>
              </Section>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  inputTouchable: {
    zIndex: 1,
  },
  input: {
    backgroundColor: "white",
    fontSize: 14,
    fontWeight: "700",
  },
  modalContainer: {
    flex: 1,
    paddingHorizontal: 16,
  },
  header: {
    marginHorizontal: 14,
    marginTop: 4,
  },
  modalInput: {
    flex: 1,
    backgroundColor: "white",
    fontSize: 14,
    fontWeight: "700",
  },
  closeButton: { bottom: 20 },
  listContent: {
    paddingTop: 12,
    paddingBottom: 20,
  },
  item: {
    padding: 12,
    borderBottomColor: "#F7F7F7",
    borderBottomWidth: 1,
    paddingHorizontal: 24,
  },
});
