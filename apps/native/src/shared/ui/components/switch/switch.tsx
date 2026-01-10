import { useState } from "react";
import {
  Switch as RNPSwitch,
  SwitchProps as RNPSwitchProps,
  Text,
} from "react-native-paper";

import { useTheme } from "@/shared/theme";

import { Row } from "../row";

export interface SwitchProps extends RNPSwitchProps {
  label?: string;
}

export const Switch = (props: SwitchProps) => {
  const { label, ...rest } = props;

  const { colors } = useTheme();

  const [checked, setChecked] = useState(false);

  const handleChange = () => {
    setChecked(!checked);
  };

  return (
    <Row centered spacing={12} style={{ bottom: 2 }}>
      <RNPSwitch
        color={colors.onBackground}
        ios_backgroundColor={colors.background}
        value={checked}
        onChange={handleChange}
        style={{ transform: [{ scale: 0.8 }] }}
        {...rest}
      />
      {label && <Text variant="bodySmall">{label}</Text>}
    </Row>
  );
};
