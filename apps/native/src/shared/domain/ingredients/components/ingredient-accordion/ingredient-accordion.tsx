import { useMemo, useState } from "react";
import { Image, Pressable, View } from "react-native";
import { Icon, Text } from "react-native-paper";

import { usePantryItems } from "@/core/supabase";
import { IngredientChild, IngredientParent } from "@/shared/supabase";
import { useTheme } from "@/shared/theme";
import { titleCase } from "@/shared/toolkit";
import { Accordion, Checkbox, Row } from "@/shared/ui";

import { IngredientItem } from "../ingredient-item";

export interface FilteredCategory {
  categoryName: string;
  parents: IngredientParent[];
  orphans: IngredientChild[];
}

export interface IngredientAccordionProps extends FilteredCategory {
  compact?: boolean;
  selectedIds?: string[];
  onSelect: (id: string) => void;
}

export const IngredientAccordion = (props: IngredientAccordionProps) => {
  const {
    compact = false,
    categoryName,
    parents,
    orphans,
    selectedIds: externalSelectedIds,
    onSelect,
  } = props;

  const category = { categoryName, parents, orphans };

  const theme = useTheme();

  const pantryItems = usePantryItems();

  const [selectedItems, setSelectedItems] = useState<string[]>([]);

  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(),
  );

  const [expandedParents, setExpandedParents] = useState<Set<string>>(
    new Set(),
  );

  // Set of ingredient UUIDs that are in the user's pantry
  const pantryIds = useMemo(
    () => new Set((pantryItems.data ?? []).map((item) => item.ingredient_id)),
    [pantryItems.data],
  );

  const handleIngredientPress = (id: string) => {
    onSelect(id);
  };

  const isExpanded = expandedCategories.has(category.categoryName);

  const itemCount =
    category.parents.reduce(
      (acc, p) => acc + (pantryIds.has(p.id) ? 1 : 0) + p.children.length,
      0,
    ) + category.orphans.length;

  const toggleCategory = (categoryName: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(categoryName)) {
        next.delete(categoryName);
      } else {
        next.add(categoryName);
      }
      return next;
    });
  };

  const toggleParentExpanded = (parentId: string) => {
    setExpandedParents((prev) => {
      const next = new Set(prev);
      if (next.has(parentId)) {
        next.delete(parentId);
      } else {
        next.add(parentId);
      }
      return next;
    });
  };

  const toggleSelect = (itemId: string) => {
    console.log("select");
    if (onSelect) {
      // Controlled mode: use external handler
      onSelect(itemId);
    } else {
      // Uncontrolled mode: use local state
      setSelectedItems((prev) =>
        prev.includes(itemId)
          ? prev.filter((id) => id !== itemId)
          : [...prev, itemId],
      );
    }
  };

  // Use external selectedIds if provided, otherwise use local state
  const selectedItemsToUse = externalSelectedIds ?? selectedItems;

  const renderParentItem = (parent: IngredientParent) => {
    const isParentInPantry = pantryIds.has(parent.id);
    const isExpanded = expandedParents.has(parent.id);
    const hasChildren = parent.children.length > 0;

    if (!isParentInPantry && !hasChildren) return null;

    return (
      <View key={parent.id}>
        {isParentInPantry && (
          <>
            <Pressable
              style={{
                alignItems: "center",
                backgroundColor: theme.colors.surface,
                flexDirection: "row",
                paddingHorizontal: 20,
                paddingBottom: 12,
              }}
              onPress={() => {
                if (hasChildren) {
                  toggleParentExpanded(parent.id);
                } else {
                  toggleSelect(parent.id);
                }
              }}
            >
              <Row wrap={false}>
                <Row centered spacing={1} style={{ left: -2, marginTop: 6 }}>
                  <Checkbox checked={true} onPress={() => {}} />
                  <Icon
                    color={theme.colors.onBackground}
                    source="chevron-down"
                    size={20}
                  />
                  <Text
                    variant={compact ? "labelSmall" : "titleSmall"}
                    style={{ color: theme.colors.onBackground }}
                  >
                    {titleCase(parent.name)}
                  </Text>
                </Row>
              </Row>
            </Pressable>
            {hasChildren && (isExpanded || !isParentInPantry) && (
              <Row
                spacing={4}
                style={{ paddingBottom: 20, paddingHorizontal: 12, bottom: 0 }}
              >
                {parent.children.map((item) => (
                  <IngredientItem
                    key={item.id}
                    item={item}
                    onPress={handleIngredientPress}
                    selected={selectedItemsToUse.includes(item.id)}
                  />
                ))}
              </Row>
            )}
          </>
        )}
      </View>
    );
  };

  return (
    <View key={category.categoryName} style={{ paddingBottom: 2 }}>
      <Accordion
        title={
          <Row centered wrap={false}>
            {!compact && (
              <View>
                <Image
                  height={64}
                  width={64}
                  source={{
                    uri: `${process.env.EXPO_PUBLIC_SUPABASE_STORAGE_URL}/category_images/${category.categoryName}.png`,
                  }}
                  style={{ borderRadius: 100, left: -8 }}
                />
              </View>
            )}

            <View style={{ gap: 2, marginLeft: 4 }}>
              <Text
                variant={compact ? "titleSmall" : "titleMedium"}
                style={{ marginRight: 80 }}
              >
                {titleCase(category.categoryName)}
              </Text>
              {!compact && (
                <Text
                  variant="labelSmall"
                  style={{
                    color: theme.colors.onBackgroundVariant,
                    bottom: 2,
                    left: 1,
                  }}
                >
                  {itemCount} {itemCount === 1 ? "Item" : "Items"}
                </Text>
              )}
            </View>
          </Row>
        }
        expanded={isExpanded}
        onPress={() => toggleCategory(category.categoryName)}
      >
        {category.orphans.length > 0 && (
          <View
            style={{
              paddingHorizontal: 12,
              paddingBottom: 12,
            }}
          >
            <Row spacing={4}>
              {category.orphans.map((item) => (
                <IngredientItem
                  key={item.id}
                  item={item}
                  onPress={handleIngredientPress}
                  selected={selectedItemsToUse.includes(item.id)}
                />
              ))}
            </Row>
          </View>
        )}
        {category.parents.map((parent) => renderParentItem(parent))}
      </Accordion>
    </View>
  );
};
