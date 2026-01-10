import { CameraView } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import {
  Image,
  ModalProps,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import { ActivityIndicator, IconButton } from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useInsertPantryItem } from "@/core/supabase";
import { useIngredientStore } from "@/features/ingredients";
import { useExtractIngredients } from "@/shared/mcp";
import { useTheme } from "@/shared/theme";
import { Row } from "@/shared/ui";

import { CameraModal } from "../camera-modal";

export type CameraProps = Pick<ModalProps, "onDismiss" | "visible">;

export const Camera = (props: CameraProps) => {
  const { onDismiss, visible } = props;

  const insertPantryItem = useInsertPantryItem();

  const { addMany } = useIngredientStore();

  const { colors } = useTheme();

  const insets = useSafeAreaInsets();

  const [image, setImage] = useState<string | null>(null);

  const [isLoading, setIsLoading] = useState(false);

  const router = useRouter();

  const { mutateAsync, isPending } = useExtractIngredients();

  const cameraRef = useRef<CameraView>(null);

  const analyze = async (base64Image?: string | null) => {
    if (!base64Image) return;

    setIsLoading(true);

    const ingredients = await mutateAsync(base64Image);

    console.log("in", ingredients);

    if (ingredients) {
      addMany(ingredients?.ingredients?.map((id) => ({ id })));
      insertPantryItem.mutate(
        ingredients?.ingredients?.map((id) => ({ ingredient_id: id })),
      );
      setIsLoading(false);
      handleDismiss();
      router.push("/ingredients");
    }
  };

  const takePicture = async () => {
    if (cameraRef.current) {
      const image = await cameraRef.current.takePictureAsync({
        base64: true,
        quality: 0.2,
        skipProcessing: true,
      });

      setImage(image?.uri);
      await analyze(image.base64);
    }
  };

  const pickImage = async () => {
    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      aspect: [4, 3],
      base64: true,
      quality: 0.2,
    });

    if (!result.canceled) {
      const image = result?.assets?.[0];
      setImage(image?.uri);
      await analyze(result?.assets?.[0].base64);
    }
  };

  const handleDismiss = () => {
    setImage(null);
    onDismiss?.();
  };

  return (
    <CameraModal
      top={isLoading && <ActivityIndicator size={20} />}
      onDismiss={handleDismiss}
    >
      <View style={styles.container}>
        {image ? (
          <View
            style={{
              borderColor: colors.primary,
              borderRadius: 12,
              borderWidth: 4,
              flex: 1,
            }}
          >
            <Image
              source={{ uri: image }}
              resizeMode="cover"
              style={{ borderRadius: 8, flexGrow: 1 }}
            />
          </View>
        ) : (
          <CameraView
            ref={cameraRef}
            active={visible}
            style={{ flexGrow: 1 }}
          />
        )}

        <Row
          centered
          style={[
            styles.controls,
            {
              backgroundColor: colors.black,
              paddingBottom: insets.bottom + 24,
              paddingTop: 40,
            },
          ]}
        >
          <IconButton
            disabled={isLoading}
            size={40}
            iconColor="white"
            icon="image"
            onPress={pickImage}
            style={{ position: "absolute", left: 24, marginBottom: 24 }}
          />
          <TouchableOpacity
            disabled={isLoading}
            onPress={takePicture}
            style={[
              styles.captureButtonOuter,
              isLoading
                ? { borderColor: colors.surfaceVariant }
                : { borderColor: "white" },
            ]}
          >
            <View
              style={[
                styles.captureButtonInner,
                isLoading
                  ? { backgroundColor: colors.surfaceVariant }
                  : { backgroundColor: "white" },
              ]}
            />
          </TouchableOpacity>
        </Row>
      </View>
    </CameraModal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  message: { textAlign: "center", paddingBottom: 10 },
  camera: { flex: 1 },
  controls: {
    alignItems: "center",
    justifyContent: "center",
  },
  captureButtonOuter: {
    width: 70,
    height: 70,
    borderRadius: 50,
    borderWidth: 3,
    borderColor: "white",
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  captureButtonInner: {
    width: 56,
    height: 56,
    borderRadius: 50,
  },
  shadowTop: { flex: 1, backgroundColor: "rgba(0, 0, 0, 0.95)" },
  shadowBottom: { flex: 1, backgroundColor: "rgba(0, 0, 0, 0.95)" },
  middleRow: { height: 540 },
});
