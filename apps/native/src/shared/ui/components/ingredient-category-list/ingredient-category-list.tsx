import { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { List, Text } from "react-native-paper";

import {
  CategoryGroup,
  IngredientChild,
  IngredientHierarchy,
  IngredientParent,
} from "@/shared/supabase";
import { useTheme } from "@/shared/theme";
import { titleCase } from "@/shared/toolkit";

import { Chip } from "../chip";
import { Row } from "../row";

export interface IngredientCategoryListProps {
  /** Hierarchical ingredient data grouped by category */
  data: IngredientHierarchy;
  /** Currently selected values (IDs or names depending on selectionKey) */
  selected?: string[];
  /** Whether selection is disabled */
  disabled?: boolean;
  /** Maximum number of selections allowed */
  maxSelections?: number;
  /** Callback when an ingredient is toggled (receives ID or name based on selectionKey) */
  onToggle?: (value: string) => void;
  /** Filter to only show ingredients matching these IDs (e.g., pantry items) */
  filterIds?: Set<string>;
  /** Whether to show parent items as expandable (default: true) */
  showParentHierarchy?: boolean;
  /** Search query to filter ingredients */
  searchQuery?: string;
  /** Display variant: chips or checkboxes */
  variant?: "chips" | "checkboxes";
  /** What to use for selection: 'id' or 'name' */
  selectionKey?: "id" | "name";
}

interface FilteredCategory extends CategoryGroup {
  categoryName: string;
}

export const IngredientCategoryList = (props: IngredientCategoryListProps) => {
  const {
    data,
    selected = [],
    disabled = false,
    maxSelections,
    onToggle,
    filterIds,
    showParentHierarchy = true,
    searchQuery = "",
    variant = "chips",
    selectionKey = "id",
  } = props;

  const theme = useTheme();

  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(),
  );
  const [expandedParents, setExpandedParents] = useState<Set<string>>(
    new Set(),
  );

  const isMaxReached = maxSelections ? selected.length >= maxSelections : false;
  const query = searchQuery.toLowerCase().trim();

  // Filter categories based on filterIds and search query
  const filteredCategories = useMemo<FilteredCategory[]>(() => {
    return Object.entries(data)
      .map(([categoryName, category]) => {
        let filteredParents: IngredientParent[] = [];
        let filteredOrphans: IngredientChild[] = [];

        category.parents.forEach((parent) => {
          // Check filter by ID
          const parentInFilter = !filterIds || filterIds.has(parent.id);
          const childrenInFilter = parent.children.filter(
            (child) => !filterIds || filterIds.has(child.id),
          );

          // Check filter by search query
          if (query) {
            const parentMatches = parent.name.toLowerCase().includes(query);
            const matchingChildren = childrenInFilter.filter((child) =>
              child.name.toLowerCase().includes(query),
            );

            if (parentMatches && parentInFilter) {
              filteredParents.push({
                ...parent,
                children: childrenInFilter,
              });
            } else if (matchingChildren.length > 0) {
              filteredParents.push({
                ...parent,
                children: matchingChildren,
              });
            }
          } else if (parentInFilter || childrenInFilter.length > 0) {
            filteredParents.push({
              ...parent,
              children: childrenInFilter,
            });
          }
        });

        // Filter orphans
        const orphansInFilter = category.orphans.filter(
          (orphan) => !filterIds || filterIds.has(orphan.id),
        );
        filteredOrphans = query
          ? orphansInFilter.filter((orphan) =>
              orphan.name.toLowerCase().includes(query),
            )
          : orphansInFilter;

        return {
          categoryName,
          parents: filteredParents,
          orphans: filteredOrphans,
        };
      })
      .filter((cat) => cat.parents.length > 0 || cat.orphans.length > 0);
  }, [data, filterIds, query]);

  const toggleCategory = useCallback((categoryName: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(categoryName)) {
        next.delete(categoryName);
      } else {
        next.add(categoryName);
      }
      return next;
    });
  }, []);

  const toggleParentExpanded = useCallback((parentId: string) => {
    setExpandedParents((prev) => {
      const next = new Set(prev);
      if (next.has(parentId)) {
        next.delete(parentId);
      } else {
        next.add(parentId);
      }
      return next;
    });
  }, []);

  const getSelectionValue = useCallback(
    (item: IngredientChild) => (selectionKey === "id" ? item.id : item.name),
    [selectionKey],
  );

  const isItemSelected = useCallback(
    (item: IngredientChild) => selected.includes(getSelectionValue(item)),
    [selected, getSelectionValue],
  );

  const handleToggle = useCallback(
    (item: IngredientChild) => {
      if (!onToggle) return;

      const value = getSelectionValue(item);
      const isCurrentlySelected = selected.includes(value);
      if (!isCurrentlySelected && isMaxReached) return;

      onToggle(value);
    },
    [onToggle, selected, isMaxReached, getSelectionValue],
  );

  const renderItem = (item: IngredientChild) => {
    const isSelected = isItemSelected(item);
    const isDisabled = disabled || (!isSelected && isMaxReached);

    if (variant === "checkboxes") {
      return (
        <Chip
          key={item.id}
          selected={isSelected}
          disabled={isDisabled}
          onPress={() => handleToggle(item)}
        >
          {titleCase(item.name)}
        </Chip>
      );
    }

    return (
      <Chip
        key={item.id}
        selected={isSelected}
        disabled={isDisabled}
        onPress={() => handleToggle(item)}
      >
        {titleCase(item.name)}
      </Chip>
    );
  };

  const renderParentItem = (parent: IngredientParent) => {
    const parentAsChild = { id: parent.id, name: parent.name };
    const isExpanded = expandedParents.has(parent.id);
    const hasChildren = parent.children.length > 0;
    const isParentInFilter = !filterIds || filterIds.has(parent.id);

    if (!isParentInFilter && !hasChildren) return null;

    if (!showParentHierarchy) {
      // Flat mode: show parent and children as items at the same level
      return (
        <View key={parent.id}>
          {isParentInFilter && renderItem(parentAsChild)}
          {parent.children.map((child) => renderItem(child))}
        </View>
      );
    }

    return (
      <View key={parent.id}>
        {isParentInFilter && (
          <Pressable
            style={styles.parentRow}
            onPress={() => {
              if (hasChildren) {
                toggleParentExpanded(parent.id);
              } else {
                handleToggle(parentAsChild);
              }
            }}
          >
            <Text variant="labelSmall" style={{ flex: 1 }}>
              {titleCase(parent.name)}
            </Text>
            {hasChildren && (
              <List.Icon
                icon={isExpanded ? "chevron-up" : "chevron-down"}
                color={theme.colors.onSurfaceVariant}
              />
            )}
          </Pressable>
        )}
        {hasChildren && (isExpanded || !isParentInFilter) && (
          <Row spacing={4} style={{ marginTop: 8 }}>
            {parent.children.map((child) => renderItem(child))}
          </Row>
        )}
      </View>
    );
  };

  const renderCategory = (category: FilteredCategory) => {
    const isExpanded = expandedCategories.has(category.categoryName);
    const itemCount =
      category.parents.reduce(
        (acc, p) =>
          acc +
          (filterIds ? (filterIds.has(p.id) ? 1 : 0) : 1) +
          p.children.length,
        0,
      ) + category.orphans.length;

    return (
      <View key={category.categoryName}>
        <Pressable
          style={styles.categoryHeader}
          onPress={() => toggleCategory(category.categoryName)}
        >
          <View style={{ flex: 1 }}>
            <Text
              variant="titleSmall"
              style={{ color: theme.colors.onSurface }}
            >
              {titleCase(category.categoryName)}
            </Text>
            <Text
              variant="labelSmall"
              style={{ color: theme.colors.onSurfaceVariant }}
            >
              {itemCount} {itemCount === 1 ? "item" : "items"}
            </Text>
          </View>
          <List.Icon
            icon={isExpanded ? "chevron-up" : "chevron-down"}
            color={theme.colors.onSurfaceVariant}
          />
        </Pressable>
        {isExpanded && (
          <View style={styles.categoryContent}>
            {category.parents.map((parent) => renderParentItem(parent))}
            {category.orphans.length > 0 && (
              <Row spacing={4}>
                {category.orphans.map((orphan) => renderItem(orphan))}
              </Row>
            )}
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {filteredCategories.map((category) => renderCategory(category))}
    </View>
  );
};

const styles = StyleSheet.create({
  categoryContent: {
    gap: 12,
    paddingBottom: 16,
    paddingLeft: 8,
  },
  categoryHeader: {
    alignItems: "center",
    flexDirection: "row",
    paddingVertical: 12,
  },
  container: {
    gap: 4,
  },
  parentRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
    minHeight: 44,
    paddingRight: 4,
  },
});
