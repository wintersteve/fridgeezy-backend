import { View } from "react-native";

import { useTheme } from "@/shared/theme";
import { Row, Skeleton } from "@/shared/ui";

import { Card } from "../card";

export const CategoryListLoading = () => {
  const { colors } = useTheme();

  return (
    <View style={{ gap: 6 }}>
      {[1, 2, 3].map((i) => (
        <Card key={i} contentStyle={{ padding: 20 }}>
          <Row spacing={20} wrap={false}>
            <Row centered spacing={14}>
              <Skeleton borderRadius={100} height={64} width={64} />
              <View style={{ gap: 8 }}>
                <Skeleton borderRadius={4} height={20} width={100} />
                <Skeleton borderRadius={4} height={14} width={60} />
              </View>
            </Row>
          </Row>
        </Card>
      ))}
    </View>
  );
};
