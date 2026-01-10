import { BottomSheetModal, BottomSheetScrollView } from "@gorhom/bottom-sheet";
import {
  forwardRef,
  ReactNode,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";

import { useIngredientsFilterStore } from "@/features/ingredients";
import { buildIngredientHierarchy, useIngredients } from "@/shared/supabase";
import { useTheme } from "@/shared/theme";
import {
  BottomSheet,
  Button,
  Chip,
  ChipProps,
  IngredientCategoryList,
  TextInput,
} from "@/shared/ui";

export interface BlacklistFilterBottomSheetRef {
  open: () => void;
  close: () => void;
}

export interface BlacklistFilterBottomSheetProps
  extends Pick<ChipProps, "disabled"> {
  children?: ReactNode | ((props: { onPress: () => void }) => ReactNode);
}

export const BlacklistFilterBottomSheet = forwardRef<
  BlacklistFilterBottomSheetRef,
  BlacklistFilterBottomSheetProps
>((props, ref) => {
  const { disabled, children } = props;

  const theme = useTheme();
  const filterStore = useIngredientsFilterStore();
  const ingredients = useIngredients();

  const bottomSheetRef = useRef<BottomSheetModal>(null);
  const [draftValue, setDraftValue] = useState<string[]>(filterStore.blacklist);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    setDraftValue(filterStore.blacklist);
  }, [filterStore.blacklist]);

  const hierarchicalIngredients = useMemo(() => {
    if (!ingredients.data) return {};
    return buildIngredientHierarchy(ingredients.data);
  }, [ingredients.data]);

  const handleOpen = useCallback(() => {
    setDraftValue(filterStore.blacklist);
    setSearchQuery("");
    bottomSheetRef.current?.present();
  }, [filterStore.blacklist]);

  const handleClose = useCallback(() => {
    bottomSheetRef.current?.dismiss();
  }, []);

  const handleToggleItem = useCallback((name: string) => {
    setDraftValue((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    );
  }, []);

  const handleConfirm = useCallback(() => {
    filterStore.setBlacklist(draftValue);
    handleClose();
  }, [draftValue, filterStore, handleClose]);

  useImperativeHandle(ref, () => ({
    open: handleOpen,
    close: handleClose,
  }));

  const renderTrigger = () => {
    if (typeof children === "function") {
      return children({ onPress: handleOpen });
    }

    if (children) {
      return children;
    }

    return (
      <Chip
        borderRadius={8}
        disabled={disabled}
        mode="outlined"
        selected={
          filterStore.blacklist.length > 0
            ? filterStore.blacklist.length
            : undefined
        }
        onPress={handleOpen}
      >
        Blacklist
      </Chip>
    );
  };

  return (
    <View>
      {renderTrigger()}
      <BottomSheet ref={bottomSheetRef} snapPoints={["90%"]}>
        <View style={styles.container}>
          <View style={styles.header}>
            <Text
              variant="headlineMedium"
              style={{ color: theme.colors.onSurface }}
            >
              Blacklist
            </Text>
            <Text style={{ color: theme.colors.onSurfaceVariant }}>
              Exclude ingredients you dislike or are allergic to
            </Text>
          </View>

          <TextInput
            label="Search for an ingredient"
            value={searchQuery}
            onChangeText={setSearchQuery}
            style={styles.searchInput}
          />

          <BottomSheetScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <IngredientCategoryList
              data={hierarchicalIngredients}
              selected={draftValue}
              searchQuery={searchQuery}
              selectionKey="name"
              onToggle={handleToggleItem}
            />
          </BottomSheetScrollView>

          <View
            style={[
              styles.footer,
              { backgroundColor: theme.colors.background },
            ]}
          >
            <Button size="sm" onPress={handleConfirm} style={{ width: "100%" }}>
              Confirm
            </Button>
          </View>
        </View>
      </BottomSheet>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  footer: {
    bottom: 0,
    left: 0,
    paddingBottom: 32,
    paddingHorizontal: 20,
    paddingTop: 8,
    position: "absolute",
    right: 0,
  },
  header: {
    alignItems: "center",
    gap: 4,
    marginBottom: 12,
  },
  scrollContent: {
    paddingBottom: 80,
  },
  searchInput: {
    marginBottom: 12,
  },
});
