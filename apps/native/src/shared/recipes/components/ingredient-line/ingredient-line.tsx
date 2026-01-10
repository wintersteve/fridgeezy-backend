import { Text } from "react-native-paper";

import { useTheme } from "@/shared/theme";

export interface IngredientLineProps {
  text: string;
  ingredients: string[];
}

export function IngredientLine(props: IngredientLineProps) {
  const { text, ingredients } = props;

  const { colors } = useTheme();

  const escaped = ingredients.map((i) =>
    i.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );

  const regex = new RegExp(`\\b(${escaped.join("|")})\\b`, "gi");

  return text.split(regex).map((part, i) =>
    ingredients.some((ing) => ing.toLowerCase() === part.toLowerCase()) ? (
      <Text
        key={i}
        style={{
          color: colors.primary,
          fontWeight: 700,
          textDecorationLine: "underline",
        }}
      >
        {part}
      </Text>
    ) : (
      part
    ),
  );
}
