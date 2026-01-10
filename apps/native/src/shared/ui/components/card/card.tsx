import { ReactNode } from "react";
import { StyleProp, ViewStyle } from "react-native";
import { Card as RNCard, CardProps as RNPCardProps } from "react-native-paper";

export interface CardProps
  extends Pick<RNPCardProps, "mode" | "onLongPress" | "onPress"> {
  borderColor?: string;
  children: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
}

export const Card = (props: CardProps) => {
  const {
    borderColor,
    children,
    contentStyle,
    mode = "outlined",
    style,
    ...rest
  } = props;

  return (
    <RNCard
      {...rest}
      mode={mode}
      style={[
        style,
        borderColor && { borderColor },
        {
          shadowOpacity: 0.0125,
          shadowRadius: 4,
          shadowOffset: { width: 0, height: 4 },
        },
      ]}
      contentStyle={[{ padding: 0 }, contentStyle]}
    >
      <RNCard.Content style={{ paddingHorizontal: 0, paddingVertical: 0 }}>
        {children}
      </RNCard.Content>
    </RNCard>
  );
};
