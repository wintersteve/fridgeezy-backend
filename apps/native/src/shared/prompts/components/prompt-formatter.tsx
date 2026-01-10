import { TextStyle } from "react-native";
import { Text, TextProps } from "react-native-paper";

import { useTheme } from "@/shared/theme";
import { AnimatedPressable, Row } from "@/shared/ui";

const REGEX = /(\{\{[a-z_]+}})/g;

export interface PromptFormatterProps
  extends Pick<TextProps<string>, "variant"> {
  disabled?: boolean;
  onPress?: (key: string) => void;
  textStyle?: TextStyle;
  value: string;
}

export const PromptFormatter = (props: PromptFormatterProps) => {
  const {
    disabled,
    onPress,
    textStyle,
    value,
    variant = "headlineMedium",
  } = props;

  const theme = useTheme();

  const segments = value.split(REGEX).filter(Boolean);

  const isTag = (segment: string) => /^\{\{[a-z_]+}}$/.test(segment);

  const format = (segment: string) =>
    segment.replace("{{", "").replace("}}", "");

  return (
    <Row>
      {segments.map((segment, index) =>
        isTag(segment) ? (
          <AnimatedPressable
            disabled={!onPress}
            key={index}
            onPress={() => onPress?.(format(segment))}
          >
            <Text
              variant={variant}
              style={[
                {
                  color: theme.colors.primary,
                  opacity: disabled ? 0.5 : 1,
                  textDecorationLine: "underline" as const,
                },
                textStyle,
              ]}
            >
              {format(segment)}
            </Text>
          </AnimatedPressable>
        ) : (
          <Text
            variant={variant}
            key={index}
            style={[
              {
                color: disabled
                  ? theme.colors.onSurfaceDisabled
                  : theme.colors.onSurfaceVariant,
              },
              textStyle,
            ]}
          >
            {segment}
          </Text>
        ),
      )}
    </Row>
  );
};
