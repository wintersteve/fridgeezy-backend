import { forwardRef, useImperativeHandle, useState } from "react";
import { View } from "react-native";
import { Badge, IconButton, Text } from "react-native-paper";

import { DifficultyFilterCard } from "@/shared/settings";
import {
  BlacklistFilterCard,
  ComponentFilterCard,
  CourseFilterCard,
  CuisineFilterCard,
  DietaryFilterCard,
} from "@/shared/tags";
import { useTheme } from "@/shared/theme";
import { Modal, ScrollView, Section } from "@/shared/ui";

import { useIngredientsFilterStore } from "../../hooks/use-ingredients-filter-store";

export interface IngredientsFilterModalRef {
  open: () => void;
  close: () => void;
}

export interface IngredientsFilterModalProps {
  hideTrigger?: boolean;
}

export const IngredientsFilterModal = forwardRef<
  IngredientsFilterModalRef,
  IngredientsFilterModalProps
>((props, ref) => {
  const { hideTrigger = false } = props;

  const [visible, setVisible] = useState(false);

  const { colors } = useTheme();

  const filterStore = useIngredientsFilterStore();

  const sessionFilterCount =
    (filterStore.cuisine ? 1 : 0) +
    (filterStore.course ? 1 : 0) +
    (filterStore.component ? 1 : 0);

  const activeFilterCount =
    filterStore.restrictions.length +
    filterStore.blacklist.length +
    (filterStore.difficulty ? 1 : 0) +
    sessionFilterCount;

  const handleOpen = () => {
    setVisible(true);
  };

  const handleClose = () => {
    setVisible(false);
  };

  const handleReset = () => {
    filterStore.resetSessionFilters();
  };

  useImperativeHandle(ref, () => ({
    open: handleOpen,
    close: handleClose,
  }));

  return (
    <>
      {!hideTrigger && (
        <View>
          <IconButton
            icon="filter-variant-plus"
            onPress={handleOpen}
            style={{ margin: 0 }}
          />
          {activeFilterCount > 0 && (
            <Badge
              size={18}
              style={{
                fontWeight: 700,
                position: "absolute",
                top: 2,
                right: 2,
                backgroundColor: colors.primary,
                pointerEvents: "none",
              }}
            >
              {activeFilterCount}
            </Badge>
          )}
        </View>
      )}
      <Modal
        left={<Text variant="headlineLarge">Filters</Text>}
        visible={visible}
        onConfirm={handleClose}
        onDismiss={handleClose}
        right={
          <IconButton
            iconColor={
              !!sessionFilterCount ? colors.onSurface : colors.onSurfaceDisabled
            }
            icon="restart"
            onPress={handleReset}
            style={{ margin: 0, left: 8 }}
          />
        }
      >
        <ScrollView
          style={{
            flex: 1,
            marginHorizontal: 12,
            marginBottom: 20,
            marginTop: 4,
          }}
        >
          <Section title="For this Search" style={{ marginTop: 12 }}>
            <View style={{ gap: 6 }}>
              <CuisineFilterCard />
              <CourseFilterCard />
              <ComponentFilterCard />
            </View>
          </Section>
          <Section title="Inherited Settings" style={{ marginTop: 12 }}>
            <View style={{ gap: 6 }}>
              <DietaryFilterCard />
              <BlacklistFilterCard />
              <DifficultyFilterCard />
            </View>
          </Section>
        </ScrollView>
      </Modal>
    </>
  );
});
