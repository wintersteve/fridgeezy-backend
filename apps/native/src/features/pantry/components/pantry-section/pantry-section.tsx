import { useState } from "react";
import { Image, ImageSourcePropType, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";

import { useInsertPantryItem } from "@/core/supabase";
// @ts-ignore
import { IngredientCategory } from "@/features/ingredients/types";
import { Tables } from "@/shared/supabase/types";
import { titleCase } from "@/shared/toolkit";
import { Accordion, Row } from "@/shared/ui";

import { PantryCategoryModal } from "../../components/pantry-category-modal";
import { PantrySelect } from "../pantry-select";

type PantryItem = Tables<"pantry_items">;

export interface PantrySectionProps {
  data: Record<IngredientCategory, PantryItem[]>;
  onConfirmPress?: (ids: string[]) => void;
  onSelect?: (ids: string[]) => void;
}

const images: Record<IngredientCategory, ImageSourcePropType> = {
  VEGETABLES: require("@/core/assets/categories/vegetables.jpeg"),
  FRUITS: require("@/core/assets/categories/fruits.jpeg"),
  MUSHROOMS: require("@/core/assets/categories/mushrooms.jpeg"),
  MEATS: require("@/core/assets/categories/meat.jpeg"),
  SEAFOOD: require("@/core/assets/categories/seafood.jpeg"),
  "FLOURS & GRAINS": require("@/core/assets/categories/flour.jpeg"),
  NOODLES: require("@/core/assets/categories/pasta.jpeg"),
  "BAKED GOODS": require("@/core/assets/categories/breads.jpeg"),
  "DAIRY & EGGS": require("@/core/assets/categories/yoghurt.jpeg"),
  "HERBS & SPICES": require("@/core/assets/categories/spices.jpeg"),
  "FATS & OILS": require("@/core/assets/categories/oils.jpeg"),
  SWEETENERS: require("@/core/assets/categories/sugars.jpeg"),
  CONDIMENTS: require("@/core/assets/categories/condiments.jpeg"),
  VINEGARS: require("@/core/assets/categories/vinegars.jpeg"),
  "NUTS & SEEDS": require("@/core/assets/categories/nuts.jpeg"),
  "BAKING INGREDIENTS": require("@/core/assets/categories/baking.jpeg"),
  "CANNED & PRESERVED": require("@/core/assets/categories/can.jpeg"),
  "PLANT-BASED": require("@/core/assets/categories/plant-based.jpeg"),
  "ALCOHOLIC BEVERAGES": require("@/core/assets/categories/wine.jpeg"),
  "NON-ALCOHOLIC BEVERAGES": require("@/core/assets/categories/non-alcoholic.jpeg"),
  BROTHS: require("@/core/assets/categories/stocks.jpeg"),
  OTHER: require("@/core/assets/categories/other.jpeg"),
};

const getUri = (category: IngredientCategory) => {
  const match = images?.[category];

  if (!match) return Image.resolveAssetSource(images.OTHER).uri;

  return Image.resolveAssetSource(match).uri;
};

export const PantrySection = (props: PantrySectionProps) => {
  const { data, onConfirmPress } = props;

  const insertPantryItem = useInsertPantryItem();

  const [modal, setModal] = useState<IngredientCategory | null>(null);

  const [accordionsOpen, setAccordionsOpen] = useState<Record<string, boolean>>(
    Object.keys(data).reduce((result, key) => ({ ...result, [key]: true }), {}),
  );

  const handleAddPress = (ids: string[]) => {
    insertPantryItem.mutate(ids.map((id) => ({ ingredient_id: id })));
  };

  return (
    <>
      <View style={{ gap: 12 }}>
        {Object.entries(data).map(([category, values]) => (
          <View key={category}>
            <Accordion
              title={
                <Row centered spacing={14} wrap={false}>
                  <View>
                    <Image
                      height={60}
                      width={60}
                      source={{ uri: getUri(category as IngredientCategory) }}
                      style={{ borderRadius: 4 }}
                    />
                    <View style={styles.overlay} />
                  </View>

                  <View style={{ gap: 2 }}>
                    <Text variant="titleMedium" style={{ marginRight: 80 }}>
                      {titleCase(category)}
                    </Text>
                    <Text variant="bodySmall" style={{ bottom: 4 }}>
                      {values.length} Items
                    </Text>
                  </View>
                </Row>
              }
              expanded={accordionsOpen[category]}
              onPress={() =>
                setAccordionsOpen({
                  ...accordionsOpen,
                  [category]: !accordionsOpen[category],
                })
              }
            >
              <PantrySelect
                data={values}
                onAddPress={() => setModal(category as IngredientCategory)}
                onConfirmPress={onConfirmPress}
              />
            </Accordion>
          </View>
        ))}
      </View>

      {modal && (
        <PantryCategoryModal
          data={modal}
          onConfirm={handleAddPress}
          onDismiss={() => setModal(null)}
          visible={Boolean(modal)}
        />
      )}
    </>
  );
};

const styles = StyleSheet.create({
  actions: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 24,
    paddingBottom: 40,
    paddingTop: 6,
    flexDirection: "row",
    justifyContent: "space-between",
    shadowOpacity: 0.05,
    shadowRadius: 4,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#1E1E1E20",
    zIndex: 1,
  },
});
