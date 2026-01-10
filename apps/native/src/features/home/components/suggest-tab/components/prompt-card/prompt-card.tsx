import { StyleSheet, View } from "react-native";
import { Icon, Text } from "react-native-paper";

import { PromptFormatter } from "@/shared/prompts";
import { useTheme } from "@/shared/theme";
import { AnimatedPressable, Card, Row } from "@/shared/ui";

interface PromptCardProps {
  icon: string;
  index: number;
  title: string;
  description: string;
  onPress: () => void;
}

export const PromptCard = ({
  icon,
  index,
  title,
  description,
  onPress,
}: PromptCardProps) => {
  const { colors } = useTheme();

  return (
    <AnimatedPressable onPress={onPress}>
      <Card style={styles.card} contentStyle={styles.content}>
        <View style={{ gap: 8 }}>
          <View
            style={{
              alignSelf: "flex-start",
              backgroundColor: colors.secondaryContainer,
              borderRadius: 100,
              left: -2,
              padding: 8,
            }}
          >
            <Icon source={icon} size={18} color={colors.secondary} />
          </View>
          <View style={styles.textContainer}>
            <Text variant="titleSmall" style={{ color: colors.onSurface }}>
              {title}
            </Text>
          </View>
        </View>
        <Row between centered wrap={false}>
          <View style={{ marginRight: "30%" }}>
            <PromptFormatter variant="bodySmall" value={description} />
          </View>
          <View style={{ position: "absolute", right: -4 }}>
            <Icon
              source="chevron-right"
              size={32}
              color={colors.onBackgroundVariant}
            />
          </View>
        </Row>
        <Text
          style={{
            color: colors.secondaryContainer,
            fontSize: 64,
            lineHeight: 72,
            position: "absolute",
            right: 0,
          }}
          variant="headlineLarge"
        >
          {index}
        </Text>
      </Card>
    </AnimatedPressable>
  );
};

const styles = StyleSheet.create({
  card: { marginBottom: 6 },
  content: { padding: 20 },
  textContainer: {
    flex: 1,
    marginBottom: 4,
  },
});
