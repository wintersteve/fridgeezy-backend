import { useRouter } from "expo-router";
import { TouchableOpacity } from "react-native";
import { Icon } from "react-native-paper";

import { useTheme } from "@/shared/theme";
import { Row } from "@/shared/ui";

export interface HeaderLeftProps {
  icon?: string;
}

export const HeaderLeft = (props: HeaderLeftProps) => {
  const { icon } = props;

  const theme = useTheme();

  const router = useRouter();

  const handlePress = () => {
    router.back();
  };

  return (
    <Row centered style={{ right: 20 }}>
      <TouchableOpacity onPress={handlePress}>
        <Icon color={theme.colors.primary} source="chevron-left" size={40} />
      </TouchableOpacity>
      {icon && <Icon color={theme.colors.primary} source={icon} size={32} />}
    </Row>
  );
};
