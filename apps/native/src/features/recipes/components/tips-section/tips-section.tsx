import { View } from "react-native";

import type { RecipeData } from "@/shared/supabase";

import { TipCard } from "./tip-card";

interface TipsSectionProps {
  data: RecipeData;
}

export const TipsSection = ({ data }: TipsSectionProps) => {
  if (!data.tips || data.tips.length === 0) return null;

  return (
    <View style={{ paddingTop: 12, paddingHorizontal: 16 }}>
      <TipCard tips={data.tips} />
    </View>
  );
};
