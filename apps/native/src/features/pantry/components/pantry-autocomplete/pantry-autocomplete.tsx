import { BottomSheetModal } from "@gorhom/bottom-sheet";
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { View } from "react-native";
import { IconButton, Text } from "react-native-paper";

import { useInsertPantryItem } from "@/core/supabase";
import { IngredientAccordions } from "@/shared/domain/ingredients";
import { useFilteredCategories, useIngredients } from "@/shared/supabase";
import { useTheme } from "@/shared/theme";
import { BottomSheet, Button, ScrollView, TextInput } from "@/shared/ui";

export interface PantryAutocompleteRef {
  open: () => void;
  close: () => void;
}

export interface PantryAutocompleteProps {
  onConfirm?: (ids: string[]) => void;
}

export const PantryAutocomplete = forwardRef<
  PantryAutocompleteRef,
  PantryAutocompleteProps
>((props, ref) => {
  const { onConfirm } = props;

  const theme = useTheme();

  const insertPantryItem = useInsertPantryItem();

  const ingredients = useIngredients();

  const bottomSheetRef = useRef<BottomSheetModal>(null);

  const [draftValue, setDraftValue] = useState<string[]>([]);

  const [searchQuery, setSearchQuery] = useState("");

  // Set of ingredient IDs that are in the user's pantry
  const ingredientIds = useMemo(
    () => new Set((ingredients.data ?? []).map((item) => item.id)),
    [ingredients.data],
  );

  const filteredCategories = useFilteredCategories(
    (id) => ingredientIds.has(id),
    searchQuery,
  );

  const handleOpen = useCallback(() => {
    setDraftValue([]);
    setSearchQuery("");
    bottomSheetRef.current?.present();
  }, []);

  const handleClose = useCallback(() => {
    bottomSheetRef.current?.dismiss();
  }, []);

  const handleConfirm = useCallback(() => {
    insertPantryItem.mutate(draftValue.map((id) => ({ ingredient_id: id })));
    onConfirm?.(draftValue);
    handleClose();
  }, [draftValue, insertPantryItem, onConfirm, handleClose]);

  const handleIngredientPress = (id: string) => {
    setDraftValue([id]);
  };

  useImperativeHandle(ref, () => ({
    open: handleOpen,
    close: handleClose,
  }));

  return (
    <View>
      <IconButton icon="plus" onPress={handleOpen} style={{ margin: 0 }} />

      <BottomSheet ref={bottomSheetRef} snapPoints={["90%"]}>
        <View
          style={{
            flex: 1,
            paddingHorizontal: 12,
            paddingTop: 8,
          }}
        >
          <View style={{ alignItems: "center", gap: 4, marginBottom: 12 }}>
            <Text
              variant="headlineMedium"
              style={{ color: theme.colors.onSurface }}
            >
              Add to Pantry
            </Text>
            <Text style={{ color: theme.colors.onSurfaceVariant }}>
              Select ingredients you have at home
            </Text>
          </View>

          <TextInput
            label="Search for an ingredient"
            value={searchQuery}
            onChangeText={setSearchQuery}
            style={{ marginBottom: 6 }}
          />

          <ScrollView>
            <View style={{ marginBottom: 100 }}>
              <IngredientAccordions
                compact
                {...filteredCategories}
                selectedIds={draftValue}
                onSelect={handleIngredientPress}
              />
            </View>
          </ScrollView>

          <View
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              backgroundColor: theme.colors.background,
              paddingHorizontal: 20,
              paddingTop: 8,
              paddingBottom: 32,
            }}
          >
            <Button size="sm" onPress={handleConfirm} style={{ width: "100%" }}>
              Add {draftValue.length > 0 ? `(${draftValue.length})` : ""}
            </Button>
          </View>
        </View>
      </BottomSheet>
    </View>
  );
});
