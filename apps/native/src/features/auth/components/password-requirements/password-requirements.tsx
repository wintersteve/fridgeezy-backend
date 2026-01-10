import { View } from "react-native";
import { Icon, Text } from "react-native-paper";

import { useTheme } from "@/shared/theme";

import { getPasswordRequirements } from "../../utils/get-password-requirements";

export interface PasswordRequirementsProps {
  password: string;
}

export const PasswordRequirements = (props: PasswordRequirementsProps) => {
  const { password } = props;

  const { colors } = useTheme();

  const requirements = getPasswordRequirements(password);

  return (
    <View style={{ gap: 8 }}>
      {requirements.map((req, index) => (
        <View
          key={index}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
          }}
        >
          <View
            style={{
              backgroundColor: req.met
                ? colors.primary
                : colors.onSurfaceDisabled,
              borderRadius: 50,
              padding: 4,
            }}
          >
            <Icon
              source={req.met ? "check-bold" : "close-thick"}
              size={12}
              color={req.met ? colors.background : colors.background}
            />
          </View>
          <Text
            variant="bodySmall"
            style={{
              color: req.met ? colors.onSurface : colors.onSurfaceVariant,
            }}
          >
            {req.text}
          </Text>
        </View>
      ))}
    </View>
  );
};
