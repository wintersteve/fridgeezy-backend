import { useRef } from "react";
import { View } from "react-native";
import { Text } from "react-native-paper";

import { useIngredientsFilterStore } from "@/features/ingredients";
import { useTheme } from "@/shared/theme";
import { titleCase } from "@/shared/toolkit";
import { Button, Card, Chip, Row } from "@/shared/ui";

import {
  BlacklistFilterBottomSheet,
  BlacklistFilterBottomSheetRef,
} from "../blacklist-filter-bottom-sheet";

export const BlacklistFilterCard = () => {
  const { colors } = useTheme();
  const filterStore = useIngredientsFilterStore();
  const bottomSheetRef = useRef<BlacklistFilterBottomSheetRef>(null);

  const displayCount =
    filterStore.blacklist.length > 0
      ? ` (${filterStore.blacklist.length})`
      : "";
  const previewItems = filterStore.blacklist.slice(0, 3);
  const hasMore = filterStore.blacklist.length > 3;

  const handleChipPress = () => {
    bottomSheetRef.current?.open();
  };

  return (
    <View>
      <Card
        contentStyle={{
          paddingHorizontal: 14,
          paddingBottom: 20,
          paddingTop: 12,
        }}
      >
        <Row between centered>
          <Text
            style={{
              color: colors.onSurface,
              marginHorizontal: 6,
              paddingBottom: 4,
            }}
            variant="titleSmall"
          >
            Blacklist
            {displayCount}
          </Text>
          <BlacklistFilterBottomSheet ref={bottomSheetRef}>
            {({ onPress }) => (
              <Button size="sm" mode="text" onPress={onPress}>
                See All
              </Button>
            )}
          </BlacklistFilterBottomSheet>
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
                  +{filterStore.blacklist.length - 3}
                </Chip>
              )}
            </>
          ) : (
            <Text
              style={{ color: colors.onSurfaceVariant, marginHorizontal: 6 }}
              variant="bodySmall"
            >
              None selected
            </Text>
          )}
        </Row>
      </Card>
    </View>
  );
};
