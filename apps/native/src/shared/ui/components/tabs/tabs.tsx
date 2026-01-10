import { ReactNode, useEffect, useState } from "react";
import { TouchableOpacity, View } from "react-native";
import { Text } from "react-native-paper";

import { useTheme } from "@/shared/theme";

import { Row } from "../row";

export interface TabsProps {
  id?: string;
  items: { id: string; content?: ReactNode }[];
  onChange?: (id: string) => void;
}

export const Tabs = (props: TabsProps) => {
  const { id: injectedId, items, onChange } = props;

  const { colors } = useTheme();

  const [id, setId] = useState<string>(injectedId ?? items[0]?.id);

  const item = items.find((item) => item.id === id)!;

  const handlePress = (id: string) => {
    setId(id);
    onChange?.(id);
  };

  useEffect(() => {
    if (injectedId) setId(injectedId);
  }, [injectedId]);

  return (
    <View style={{ gap: 32 }}>
      <Row
        spacing={4}
        wrap={false}
        style={{
          backgroundColor: colors.backgroundVariant,
          borderRadius: 28,
          padding: 4,
          marginHorizontal: -4,
        }}
      >
        {items.map((item) => (
          <TouchableOpacity
            key={item.id}
            style={{
              alignItems: "center",
              backgroundColor:
                item.id === id ? colors.background : colors.backgroundVariant,
              borderBottomWidth: item.id === id ? 2 : 0,
              borderColor: colors.primary,
              padding: 16,
              width: "49.5%",
            }}
            onPress={() => handlePress(item.id)}
          >
            <Text
              variant="labelMedium"
              style={{
                color:
                  item.id === id ? colors.primary : colors.onSurfaceVariant,
              }}
            >
              {item.id}
            </Text>
          </TouchableOpacity>
        ))}
      </Row>
      <View>{item?.content}</View>
    </View>
  );
};
