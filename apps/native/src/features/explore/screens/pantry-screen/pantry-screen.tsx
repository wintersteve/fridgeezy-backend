import { BottomSheetModal } from "@gorhom/bottom-sheet";
import { useNavigation } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";

import { usePantryItems } from "@/core/supabase";
import { PantryAutocomplete } from "@/features/pantry";
import {
  IngredientAccordions,
  IngredientsBottomSheet,
} from "@/shared/domain/ingredients";
import { ExploreHeaderToggle } from "@/shared/explore";
import { useFilteredCategories } from "@/shared/supabase";
import { Row, ScrollView, Section, TextInput } from "@/shared/ui";

export const PantryScreen = () => {
  const pantryItems = usePantryItems();

  const navigation = useNavigation();

  const bottomSheetRef = useRef<BottomSheetModal>(null);

  const [searchQuery, setSearchQuery] = useState("");

  const [id, setId] = useState<string | null>(null);

  const pantryIds = useMemo(
    () => new Set((pantryItems.data ?? []).map((item) => item.ingredient_id)),
    [pantryItems.data],
  );

  const filtered = useFilteredCategories(
    (id) => pantryIds.has(id),
    searchQuery,
  );

  const handleSelect = (id: string) => {
    setId(id);
    console.log(id);
    bottomSheetRef.current?.present();
  };

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Row>
          <PantryAutocomplete />
          <ExploreHeaderToggle />
        </Row>
      ),
    });
  }, [navigation]);

  return (
    <>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={{
          paddingHorizontal: 12,
          paddingTop: 12,
          paddingBottom: 120,
        }}
      >
        <Section title={`${pantryItems.data?.length ?? 0} Items`}>
          <View style={{ gap: 12 }}>
            <View style={{ marginHorizontal: 4 }}>
              <TextInput
                icon="magnify"
                label="Search ingredients..."
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
            </View>
            <IngredientAccordions {...filtered} onSelect={handleSelect} />
          </View>
        </Section>
      </ScrollView>
      <IngredientsBottomSheet ref={bottomSheetRef} id={id} />
    </>
  );
};
