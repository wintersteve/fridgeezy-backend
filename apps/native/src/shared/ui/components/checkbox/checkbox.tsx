import { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import {
  Checkbox as RNPCheckbox,
  CheckboxProps as RNPCheckboxProps,
} from "react-native-paper";

import { useTheme } from "@/shared/theme";

import { Row } from "../row";

export interface CheckboxProps extends Omit<RNPCheckboxProps, "status"> {
  checked: boolean;
  children?: ReactNode;
  indeterminate?: boolean;
}

export const Checkbox = (props: CheckboxProps) => {
  const { checked, children, indeterminate, onPress, ...rest } = props;

  const theme = useTheme();

  const getStatus = () => {
    if (indeterminate) return "indeterminate";
    return checked ? "checked" : "unchecked";
  };

  return (
    <Row centered spacing={8} style={{ marginLeft: -8 }}>
      <RNPCheckbox.Item
        label=""
        mode="android"
        status={getStatus()}
        color={theme.colors.secondary}
        style={styles.checkbox}
        onPress={onPress}
        {...rest}
      />
      {children && <View>{children}</View>}
    </Row>
  );
};

const styles = StyleSheet.create({
  checkbox: { maxHeight: 38, paddingHorizontal: 0, left: 4 },
});
