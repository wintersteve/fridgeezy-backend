import { forwardRef, useImperativeHandle, useState, useEffect } from "react";
import { View, Pressable } from "react-native";
import { Icon, IconButton, Text } from "react-native-paper";

import { useUpdatePantryItem, PantryItemWithIngredient } from "@/core/supabase";
import { useTheme } from "@/shared/theme";
import { Calendar } from "@/shared/time";
import { formatDateShort, titleCase } from "@/shared/toolkit";
import { Modal, Card, Row } from "@/shared/ui";

export interface EditPantryItemModalRef {
  open: (item: PantryItemWithIngredient) => void;
  close: () => void;
}

export interface EditPantryItemModalProps {
  onSuccess?: () => void;
}

export const EditPantryItemModal = forwardRef<
  EditPantryItemModalRef,
  EditPantryItemModalProps
>((props, ref) => {
  const { onSuccess } = props;

  const [visible, setVisible] = useState(false);
  const [pantryItem, setPantryItem] = useState<PantryItemWithIngredient | null>(
    null,
  );

  // Draft state for form fields
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);

  const theme = useTheme();
  const updatePantryItem = useUpdatePantryItem();

  // Reset form when opened with new item
  useEffect(() => {
    if (visible && pantryItem) {
      setExpiresAt(
        pantryItem.expires_at ? new Date(pantryItem.expires_at) : null,
      );
      setShowDatePicker(false);
    }
  }, [visible, pantryItem]);

  const handleOpen = (item: PantryItemWithIngredient) => {
    setPantryItem(item);
    setVisible(true);
  };

  const handleClose = () => {
    setVisible(false);
    setShowDatePicker(false);
  };

  const handleConfirm = () => {
    if (!pantryItem) return;

    updatePantryItem.mutate(
      {
        id: pantryItem.id,
        updates: {
          expires_at: expiresAt?.toISOString() ?? null,
        },
      },
      {
        onSuccess: () => {
          handleClose();
          onSuccess?.();
        },
      },
    );
  };

  const handleToggle = () => {
    setShowDatePicker(() => !showDatePicker);
  };

  const hasChanges = () => {
    if (!pantryItem) return false;

    const originalDate = pantryItem.expires_at
      ? new Date(pantryItem.expires_at).toDateString()
      : null;
    const newDate = expiresAt?.toDateString() ?? null;

    return originalDate !== newDate;
  };

  useImperativeHandle(ref, () => ({
    open: handleOpen,
    close: handleClose,
  }));

  return (
    <Modal
      visible={visible}
      onDismiss={handleClose}
      onConfirm={handleConfirm}
      confirmButton={{
        content: updatePantryItem.isPending ? "Saving..." : "Save Changes",
        disabled: !hasChanges() || updatePantryItem.isPending,
      }}
      left={
        <Text variant="headlineLarge">
          {titleCase(pantryItem?.ingredient?.name ?? "")}
        </Text>
      }
    >
      <View style={{ paddingHorizontal: 12, paddingTop: 12, gap: 6 }}>
        {/* Expiration Date Section */}
        <Pressable onPress={handleToggle}>
          <Card contentStyle={{ padding: 12 }}>
            <Row between centered>
              <Row centered spacing={12} style={{ marginLeft: 4 }}>
                <Icon
                  source="calendar"
                  size={24}
                  color={theme.colors.primary}
                />
                <View style={{ gap: 2 }}>
                  <Text variant="labelMedium">Expiration Date</Text>
                  <Text
                    variant="bodySmall"
                    style={{ color: theme.colors.onSurfaceVariant }}
                  >
                    {expiresAt
                      ? formatDateShort(expiresAt.toISOString())
                      : "Not set"}
                  </Text>
                </View>
              </Row>
              {showDatePicker && (
                <Row style={{ left: 6 }}>
                  <IconButton
                    icon="close-thick"
                    size={24}
                    iconColor={theme.colors.error}
                    style={{ marginVertical: 0, marginRight: 0, left: 2 }}
                  />
                  <IconButton
                    icon="check-bold"
                    size={24}
                    iconColor={theme.colors.difficultyEasy}
                    style={{ marginVertical: 0, marginLeft: 0 }}
                  />
                </Row>
              )}
            </Row>
          </Card>
        </Pressable>

        {/* Date Picker */}
        {showDatePicker && (
          <>
            <Card contentStyle={{ paddingVertical: 8 }}>
              <Calendar onChange={() => {}} />
            </Card>
            {/*<DateTimePicker*/}
            {/*  value={expiresAt ?? new Date()}*/}
            {/*  mode="date"*/}
            {/*  display={Platform.OS === "ios" ? "spinner" : "default"}*/}
            {/*  onChange={(event, date) => {*/}
            {/*    if (Platform.OS === "android") {*/}
            {/*      setShowDatePicker(false);*/}
            {/*    }*/}

            {/*    if (date) {*/}
            {/*      setExpiresAt(date);*/}
            {/*    }*/}
            {/*  }}*/}
            {/*/>*/}
          </>
        )}

        {/* Future sections will go here */}
        {/*
        <Section title="Quantity">
          // Quantity input
        </Section>

        <Section title="Location">
          // Location picker
        </Section>

        <Section title="Notes">
          // Notes text area
        </Section>
        */}
      </View>
    </Modal>
  );
});
