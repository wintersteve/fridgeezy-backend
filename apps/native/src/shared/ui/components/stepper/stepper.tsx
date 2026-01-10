import { ReactNode, useEffect, useState } from "react";
import { View, ViewStyle } from "react-native";

import { useTheme } from "@/shared/theme";

import { Row } from "../row";
import { SwipeGesture, SwipeGestureDirection } from "../swipe-gesture";

export interface StepperItem {
  id: string;
  content: ReactNode;
}

export interface StepperProps {
  index?: number;
  items: StepperItem[];
  onSwipe?: (index: number) => void;
  style?: ViewStyle;
}

export const Stepper = (props: StepperProps) => {
  const { index: injectedIndex = 0, items, onSwipe, style } = props;

  const [index, setIndex] = useState(injectedIndex);

  const { colors } = useTheme();

  const step = items[index];

  const count = items.length;

  useEffect(() => {
    setIndex(injectedIndex);
  }, [injectedIndex]);

  const handleSwipe = (direction: SwipeGestureDirection) => {
    if (direction === "left" && index < count - 1) {
      const nextIndex = index + 1;
      setIndex(nextIndex);
      onSwipe?.(nextIndex);
    }

    if (direction === "right" && index > 0) {
      const nextIndex = index - 1;
      setIndex(nextIndex);
      onSwipe?.(nextIndex);
    }
  };

  return (
    <View
      style={[
        {
          flex: 1,
          alignItems: "center",
          justifyContent: "space-between",
        },
        style,
      ]}
    >
      <SwipeGesture onSwipe={handleSwipe} style={{ width: "100%", flex: 1 }}>
        <View style={{ flex: 1, paddingBottom: 8 }}>{step?.content}</View>
        <Row
          centered
          spacing={6}
          style={{
            borderRadius: 8,
            justifyContent: "center",
            marginTop: 8,
            padding: 8,
          }}
        >
          {items.map((item, i) => (
            <View
              key={item.id}
              style={{
                backgroundColor:
                  index === i ? colors.primary : colors.primaryContainer,
                borderRadius: 100,
                minHeight: 6,
                minWidth: 6,
              }}
            />
          ))}
        </Row>
      </SwipeGesture>
    </View>
  );
};
