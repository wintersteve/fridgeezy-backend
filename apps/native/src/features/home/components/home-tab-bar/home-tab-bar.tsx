import { useTheme } from "@/shared/theme";
import { Button, Row, ScrollView } from "@/shared/ui";

import { TABS } from "../../constants";

export interface HomeTabBarProps {
  index: number;
  onChange: (index: number) => void;
}

export const HomeTabBar = (props: HomeTabBarProps) => {
  const { index, onChange } = props;

  const theme = useTheme();

  return (
    <ScrollView horizontal>
      <Row
        centered
        spacing={4}
        style={{
          paddingHorizontal: 14,
          paddingBottom: 8,
        }}
      >
        {TABS.map((route, i) => {
          const isActive = index === i;
          return (
            <Button
              key={route.key}
              icon={route.icon}
              mode={isActive ? "outlined" : "text"}
              contentStyle={{ paddingVertical: 4 }}
              style={{ borderRadius: 10 }}
              onPress={() => onChange(i)}
              textColor={
                isActive ? theme.colors.primary : theme.colors.onSurfaceDisabled
              }
            >
              {route.title}
            </Button>
          );
        })}
      </Row>
    </ScrollView>
  );
};
