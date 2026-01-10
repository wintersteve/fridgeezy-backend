import Fuse from "fuse.js";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";

import { RecipeData } from "@/shared/supabase";
import { titleCase } from "@/shared/toolkit";
import {
  Card,
  Chip,
  Modal,
  ModalProps,
  Row,
  Section,
  Stepper,
} from "@/shared/ui";

export interface StepsModalProps extends Omit<ModalProps, "onConfirm"> {
  data: RecipeData;
}

const findIngredients = (data: RecipeData, instruction: string) => {
  const ingredients = (data as any).ingredients ?? [];
  if (!ingredients.length) return [];

  const fuse = new Fuse(instruction.toUpperCase().split(" "), {
    minMatchCharLength: 2,
    threshold: 0.2,
  });

  return ingredients.filter(
    (item: any) => item.ingredient && fuse.search(item.ingredient.name)[0],
  );
};

export const StepsModal = (props: StepsModalProps) => {
  const { data, visible, onDismiss } = props;

  const [index, setIndex] = useState(0);

  const images = [
    "https://qkxznjwlybjqpcauaisz.supabase.co/storage/v1/object/public/cooking_actions_images/cut.png",
    "https://qkxznjwlybjqpcauaisz.supabase.co/storage/v1/object/public/cooking_actions_images/peel.png",
    "https://qkxznjwlybjqpcauaisz.supabase.co/storage/v1/object/public/cooking_actions_images/whisk.png",
  ];

  const image =
    images?.[index] ??
    "https://qkxznjwlybjqpcauaisz.supabase.co/storage/v1/object/public/cooking_actions_images/cut.png";

  const handleConfirm = () => {
    setIndex(index + 1);
  };

  const handleDismiss = () => {
    onDismiss?.();
    setIndex(0);
  };

  return (
    <Modal
      onConfirm={handleConfirm}
      onDismiss={handleDismiss}
      visible={visible}
      confirmButton={{ content: "Next" }}
      headerImage={image}
    >
      {/* Content card with rounded top borders */}
      <View style={styles.cardContainer}>
        {data.instructions.length > 0 ? (
          <Stepper
            index={index}
            items={data.instructions.map((instruction, idx) => {
              const matchedIngredients = findIngredients(data, instruction);
              return {
                id: instruction,
                content: (
                  <Section title={`Step ${idx + 1}`}>
                    {matchedIngredients.length > 0 && (
                      <Row spacing={6}>
                        {matchedIngredients.map((item: any) => (
                          <Chip key={item.ingredient.id}>
                            {titleCase(item.ingredient.name)}
                          </Chip>
                        ))}
                      </Row>
                    )}
                    <Card contentStyle={{ padding: 12 }}>
                      <Text variant="bodyMedium">{instruction}</Text>
                    </Card>
                  </Section>
                ),
              };
            })}
            onSwipe={setIndex}
          />
        ) : (
          <Text>No steps provided.</Text>
        )}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  cardContainer: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 24,
    flex: 1,
  },
  instruction: { flexShrink: 1, marginHorizontal: 2, marginTop: 2 },
});
