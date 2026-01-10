import { ReactNode } from "react";
import { View } from "react-native";
import { List, ListItemProps, Text } from "react-native-paper";

import { useTheme } from "@/shared/theme";
import { Card } from "@/shared/ui";

import { Row } from "../row";

export interface AccordionProps extends Omit<ListItemProps, "title"> {
  children: ReactNode;
  expanded: boolean;
  icon?: ReactNode;
  title: ReactNode;
}

export const Accordion = (props: AccordionProps) => {
  const { children, expanded, icon, id, title, onPress } = props;

  const { colors, fonts } = useTheme();

  return (
    <Card>
      <List.Accordion
        id={id}
        expanded={expanded}
        title={
          <Row centered spacing={12}>
            {icon}
            <Text variant="headlineSmall">{title}</Text>
          </Row>
        }
        titleStyle={[
          fonts.titleMedium,
          { color: expanded ? colors.onSurface : colors.onSurfaceDisabled },
        ]}
        rippleColor="transparent"
        onPress={onPress}
        style={{ backgroundColor: colors.surface }}
      >
        <View>{children}</View>
      </List.Accordion>
    </Card>
  );
};
