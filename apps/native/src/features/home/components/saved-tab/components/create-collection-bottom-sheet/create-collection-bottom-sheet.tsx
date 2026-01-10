import { BottomSheetModal, BottomSheetView } from "@gorhom/bottom-sheet";
import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { View } from "react-native";
import { Text } from "react-native-paper";

import { useInsertCollection } from "@/core/supabase";
import { useTheme } from "@/shared/theme";
import { BottomSheet, Button, TextInput } from "@/shared/ui";

export interface CreateCollectionBottomSheetRef {
  open: () => void;
  close: () => void;
}

export const CreateCollectionBottomSheet = forwardRef<
  CreateCollectionBottomSheetRef,
  object
>((_, ref) => {
  const { colors } = useTheme();

  const bottomSheetRef = useRef<BottomSheetModal>(null);

  const [title, setTitle] = useState("");

  const [description, setDescription] = useState("");

  const insertCollection = useInsertCollection();

  useImperativeHandle(ref, () => ({
    open: () => {
      setTitle("");
      setDescription("");
      bottomSheetRef.current?.present();
    },
    close: () => {
      bottomSheetRef.current?.dismiss();
    },
  }));

  const handleConfirm = async () => {
    if (!title.trim()) return;

    await insertCollection.mutateAsync({
      title: title.trim(),
      description: description.trim() || null,
    });

    bottomSheetRef.current?.dismiss();
  };

  const isValid = title.trim().length > 0;

  return (
    <BottomSheet ref={bottomSheetRef} snapPoints={["74%"]}>
      <BottomSheetView style={{ flex: 1, paddingHorizontal: 20 }}>
        <Text
          variant="headlineSmall"
          style={{
            color: colors.onSurface,
            marginBottom: 20,
            textAlign: "center",
          }}
        >
          Add Collection
        </Text>

        <View style={{ gap: 12 }}>
          <TextInput
            label="Title*"
            value={title}
            onChangeText={setTitle}
            autoFocus
          />

          <TextInput
            label="Description"
            value={description}
            onChangeText={setDescription}
          />
        </View>

        <Button
          mode="contained"
          onPress={handleConfirm}
          disabled={!isValid}
          loading={insertCollection.isPending}
          style={{ marginTop: 24 }}
        >
          Create Collection
        </Button>
      </BottomSheetView>
    </BottomSheet>
  );
});
