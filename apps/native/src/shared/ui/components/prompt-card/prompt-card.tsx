import { StyleSheet, View } from "react-native";
import { IconButton } from "react-native-paper";

import { PromptFormatter } from "@/shared/prompts";
import { useTheme } from "@/shared/theme";

import { AnimatedPressable } from "../animated-pressable";
import { Card } from "../card";
import { Row } from "../row";

export interface PromptCardProps {
  prompt: string;
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  onPress: () => void;
}

export const PromptCard = (props: PromptCardProps) => {
  const { prompt, isFirst, isLast, onMoveUp, onMoveDown, onDelete, onPress } =
    props;

  const { colors } = useTheme();

  return (
    <AnimatedPressable onPress={onPress}>
      <Card style={styles.card}>
        <Row between centered style={styles.content}>
          <View style={styles.textContainer}>
            <PromptFormatter value={prompt} variant="bodyMedium" />
          </View>
          <Row centered spacing={0} wrap={false}>
            <IconButton
              icon="chevron-up"
              size={20}
              onPress={onMoveUp}
              disabled={isFirst}
              style={styles.iconButton}
            />
            <IconButton
              icon="chevron-down"
              size={20}
              onPress={onMoveDown}
              disabled={isLast}
              style={styles.iconButton}
            />
            <IconButton
              icon="trash-can-outline"
              size={20}
              onPress={onDelete}
              iconColor={colors.error}
              style={styles.iconButton}
            />
          </Row>
        </Row>
      </Card>
    </AnimatedPressable>
  );
};

const styles = StyleSheet.create({
  card: {
    marginBottom: 8,
  },
  content: {
    padding: 12,
  },
  textContainer: {
    flex: 1,
    marginRight: 8,
  },
  iconButton: {
    margin: 0,
  },
});
