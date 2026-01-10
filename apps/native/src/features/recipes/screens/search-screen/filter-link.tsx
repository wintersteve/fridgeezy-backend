import { Text } from "react-native-paper";

import { useTheme } from "@/shared/theme";
import { FilterBottomSheet } from "@/shared/ui";

interface FilterLinkProps {
  description: string;
  label: string;
  onChange: (value: string[]) => void;
  options: readonly string[];
  title: string;
  value: string[];
}

export const FilterLink = (props: FilterLinkProps) => {
  const { description, label, onChange, options, title, value } = props;

  const { colors } = useTheme();

  return (
    <FilterBottomSheet
      description={description}
      options={options}
      onChange={onChange}
      title={title}
      value={value}
    >
      {({ onPress }) => (
        <Text
          onPress={onPress}
          style={{
            color: colors.primary,
            fontWeight: "700",
            textDecorationLine: "underline",
          }}
        >
          {label}
        </Text>
      )}
    </FilterBottomSheet>
  );
};
