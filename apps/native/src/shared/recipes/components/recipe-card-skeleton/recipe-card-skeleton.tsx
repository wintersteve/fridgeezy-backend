import { View } from "react-native";

import { useTheme } from "@/shared/theme";
import { Skeleton } from "@/shared/ui";

export const RecipeCardSkeleton = () => {
  const { colors } = useTheme();

  return (
    <View
      style={{
        borderColor: colors.surfaceDisabled,
        borderRadius: 24,
        borderWidth: 1,
        padding: 24,
      }}
    >
      <View style={{ gap: 8 }}>
        <View style={{ gap: 4 }}>
          <Skeleton height={28} width="70%" />
          <Skeleton height={18} width="90%" />
        </View>
        <Skeleton height={16} width="30%" />
        <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
          <Skeleton height={24} width={80} borderRadius={12} />
          <Skeleton height={24} width={60} borderRadius={12} />
          <Skeleton height={24} width={70} borderRadius={12} />
        </View>
      </View>
    </View>
  );
};
