import { BottomSheetModal } from "@gorhom/bottom-sheet";
import {
  forwardRef,
  ReactNode,
  useCallback,
  useImperativeHandle,
  useRef,
} from "react";
import { View } from "react-native";
import { Text } from "react-native-paper";

import { usePantryItems } from "@/core/supabase";
import { useTheme } from "@/shared/theme";
import { titleCase } from "@/shared/toolkit";
import {
  BottomSheet,
  Button,
  Chip,
  ChipProps,
  Row,
  ScrollView,
} from "@/shared/ui";

export interface PantryIngredientBottomSheetRef {
  open: () => void;
  close: () => void;
}

export interface PantryIngredientBottomSheetProps
  extends Pick<ChipProps, "disabled"> {
  children?: ReactNode | ((props: { onPress: () => void }) => ReactNode);
  onChange: (value: string) => void;
  value?: string;
}

export const PantryIngredientBottomSheet = forwardRef<
  PantryIngredientBottomSheetRef,
  PantryIngredientBottomSheetProps
>((props, ref) => {
  const { disabled, children, onChange, value } = props;

  const theme = useTheme();
  const pantryItems = usePantryItems();

  const bottomSheetRef = useRef<BottomSheetModal>(null);

  const handleOpen = useCallback(() => {
    bottomSheetRef.current?.present();
  }, []);

  const handleClose = useCallback(() => {
    bottomSheetRef.current?.dismiss();
  }, []);

  const handleSelect = useCallback(
    (name: string) => {
      onChange(name);
      handleClose();
    },
    [onChange, handleClose],
  );

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
        selected={value ? 1 : undefined}
        onPress={handleOpen}
      >
        Ingredient
      </Chip>
    );
  };

  const ingredients =
    pantryItems.data
      ?.map((item) => item.ingredient?.name)
      .filter((name): name is string => Boolean(name)) ?? [];

  return (
    <View>
      {renderTrigger()}
      <BottomSheet ref={bottomSheetRef} snapPoints={["70%"]}>
        <View
          style={{
            flex: 1,
            paddingHorizontal: 20,
            paddingTop: 8,
          }}
        >
          <ScrollView style={{ flex: 1 }}>
            <View style={{ alignItems: "center", gap: 4 }}>
              <Text
                variant="headlineMedium"
                style={{ color: theme.colors.onSurface }}
              >
                Ingredient
              </Text>
              <Text style={{ color: theme.colors.onSurfaceVariant }}>
                Select an ingredient from your pantry
              </Text>
            </View>
            <Row spacing={6} style={{ marginVertical: 12 }}>
              {ingredients.map((name) => (
                <Chip
                  key={name}
                  selected={value === name}
                  onPress={() => handleSelect(name)}
                >
                  {titleCase(name)}
                </Chip>
              ))}
            </Row>
            {ingredients.length === 0 && (
              <Text
                style={{
                  color: theme.colors.onSurfaceVariant,
                  textAlign: "center",
                  marginTop: 20,
                }}
              >
                Your pantry is empty. Add some ingredients first!
              </Text>
            )}
          </ScrollView>
          <Button
            size="sm"
            mode="text"
            onPress={handleClose}
            style={{
              width: "100%",
              marginTop: 8,
              marginBottom: 32,
            }}
          >
            Cancel
          </Button>
        </View>
      </BottomSheet>
    </View>
  );
});
