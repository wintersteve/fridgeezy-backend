import { useRef } from "react";
import { Icon, IconButton, Text } from "react-native-paper";

import { useTheme } from "@/shared/theme";
import { titleCase } from "@/shared/toolkit";
import {
  FilterBottomSheet,
  FilterBottomSheetRef,
  Card,
  Chip,
  Row,
  AnimatedPressable,
} from "@/shared/ui";

interface FilterCardProps {
  description: string;
  onChange: (value: string[]) => void;
  onClear?: () => void;
  options: readonly string[];
  title: string;
  value: string[];
}

export const FilterCard = (props: FilterCardProps) => {
  const { description, onChange, onClear, options, title, value } = props;

  const { colors } = useTheme();

  const bottomSheetRef = useRef<FilterBottomSheetRef>(null);

  const displayCount = value.length > 0 ? ` (${value.length})` : "";

  const previewItems = value.slice(0, 3);

  const hasMore = value.length > 3;

  const handleChipPress = () => {
    bottomSheetRef.current?.open();
  };

  return (
    <FilterBottomSheet
      ref={bottomSheetRef}
      description={description}
      options={options}
      onChange={onChange}
      title={title}
      value={value}
    >
      {({ onPress }) => (
        <AnimatedPressable onPress={onPress}>
          <Card
            contentStyle={{
              paddingHorizontal: 12,
              paddingVertical: 20,
            }}
          >
            <Row between wrap={false} style={{ width: "100%" }}>
              <Text
                style={{
                  color: colors.onSurface,
                  marginHorizontal: 6,
                  marginBottom: 12,
                }}
                variant="titleSmall"
              >
                {title}
                {displayCount}
              </Text>
              {!!value.length && (
                <IconButton
                  iconColor={
                    value.length > 0 ? colors.error : colors.onSurfaceDisabled
                  }
                  icon="close-thick"
                  size={20}
                  style={{ margin: 0, top: -6 }}
                  onPress={onClear}
                />
              )}
            </Row>
            <Row>
              {previewItems.length > 0 ? (
                <>
                  {previewItems.map((item) => (
                    <Chip
                      key={item}
                      selected
                      style={{ flexShrink: 1, width: "auto", marginLeft: 4 }}
                      onPress={handleChipPress}
                    >
                      {titleCase(item)}
                    </Chip>
                  ))}
                  {hasMore && (
                    <Chip
                      style={{ flexShrink: 1, width: "auto" }}
                      onPress={handleChipPress}
                    >
                      +{value.length - 3}
                    </Chip>
                  )}
                </>
              ) : (
                <Row centered style={{ marginLeft: 2 }} spacing={4}>
                  <Icon
                    color={colors.onBackgroundVariant}
                    source="chevron-down"
                    size={14}
                  />
                  <Text
                    style={{ color: colors.onBackgroundVariant }}
                    variant="bodySmall"
                  >
                    None selected
                  </Text>
                </Row>
              )}
            </Row>
          </Card>
        </AnimatedPressable>
      )}
    </FilterBottomSheet>
  );
};
