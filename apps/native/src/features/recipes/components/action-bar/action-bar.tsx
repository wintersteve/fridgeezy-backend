import { MenuView } from "@react-native-menu/menu";
import { useMemo } from "react";
import { Platform } from "react-native";
import { Card, IconButton } from "react-native-paper";

import {
  useDeleteProfileRecipeInteraction,
  useDeleteShoppingList,
  useInsertProfileRecipeInteraction,
  useInsertShoppingList,
  useProfileRecipeInteractions,
  useShoppingLists,
} from "@/core/supabase";
import { Recipe } from "@/shared/entities";
import { Row } from "@/shared/ui";

import { useCookedModalStore } from "../../hooks/use-cooked-modal-store";
import { FavoriteButton } from "../favorite-button";

export interface ActionBarProps {
  data: Recipe;
  outline?: boolean;
}

export const ActionBar = (props: ActionBarProps) => {
  const { data } = props;
  const { id } = data;

  // Shopping list state
  const shoppingLists = useShoppingLists();
  const insertShoppingList = useInsertShoppingList();
  const deleteShoppingList = useDeleteShoppingList();
  const hasShoppingList = shoppingLists.data?.some((s) => s.recipe_id === id);

  // Cooked state
  const cooked = useProfileRecipeInteractions("cooked");
  const insertInteraction = useInsertProfileRecipeInteraction();
  const deleteInteraction = useDeleteProfileRecipeInteraction();
  const isCooked = cooked.data?.some((c) => c.recipe_id === id);

  // Modal for cooked
  const cookedModalStore = useCookedModalStore();

  const actions = useMemo(
    () => [
      {
        id: "variations",
        title: "Variations",
        image: Platform.select({
          ios: "slider.horizontal.3",
          android: "ic_menu_sort_by_size",
        }),
        subactions: [
          {
            id: "increase-difficulty",
            title: "Make it Fancier",
            subtitle: "Increase complexity",
            image: Platform.select({
              ios: "arrow.up.circle",
              android: "ic_menu_upload",
            }),
          },
          {
            id: "decrease-difficulty",
            title: "Simplify",
            subtitle: "Reduce complexity",
            image: Platform.select({
              ios: "arrow.down.circle",
              android: "ic_menu_revert",
            }),
          },
        ],
      },
      {
        id: "substitutes",
        title: "Substitutes",
        image: Platform.select({
          ios: "arrow.triangle.2.circlepath",
          android: "ic_menu_rotate",
        }),
        subactions: [
          {
            id: "select-missing",
            title: "Select Missing Ingredients",
            subtitle: "Mark what you don't have",
            image: Platform.select({
              ios: "checklist",
              android: "ic_menu_agenda",
            }),
          },
          {
            id: "suggest-substitutes",
            title: "Suggest Substitutes",
            subtitle: "Get alternative ingredients",
            image: Platform.select({
              ios: "lightbulb",
              android: "ic_menu_help",
            }),
          },
        ],
      },
      {
        id: "compose",
        title: "Compose",
        image: Platform.select({
          ios: "square.stack.3d.up",
          android: "ic_menu_manage",
        }),
        subactions: [
          {
            id: "make-dish",
            title: "Make into Dish",
            subtitle: "Create a complete dish",
            image: Platform.select({
              ios: "fork.knife",
              android: "ic_menu_myplaces",
            }),
          },
          {
            id: "make-course",
            title: "Make into Course",
            subtitle: "Add to a meal course",
            image: Platform.select({
              ios: "list.bullet.rectangle",
              android: "ic_menu_gallery",
            }),
          },
        ],
      },
      {
        id: "cooked",
        title: isCooked ? "Remove from Cooked" : "Add to Cooked",
        image: Platform.select({
          ios: isCooked ? "checkmark.circle.fill" : "checkmark.circle",
          android: "ic_menu_agenda",
        }),
      },
      {
        id: "shopping-list",
        title: hasShoppingList
          ? "Remove from Shopping List"
          : "Add to Shopping List",
        image: Platform.select({
          ios: hasShoppingList ? "cart.badge.minus" : "cart.badge.plus",
          android: "ic_menu_add",
        }),
      },
    ],
    [hasShoppingList, isCooked],
  );

  return (
    <Card elevation={0}>
      <Row>
        <FavoriteButton data={data} />
        <MenuView
          onPressAction={({ nativeEvent }) => {
            const actionId = nativeEvent.event;

            switch (actionId) {
              case "shopping-list":
                if (hasShoppingList) {
                  deleteShoppingList.mutate({ recipe_id: id });
                } else {
                  insertShoppingList.mutate({ recipe_id: id });
                }
                break;

              case "cooked":
                if (isCooked) {
                  deleteInteraction.mutate({
                    recipe_id: id,
                    interaction_type: "cooked",
                  });
                } else {
                  insertInteraction.mutate({
                    recipe_id: id,
                    interaction_type: "cooked",
                  });
                  cookedModalStore.toggle();
                }
                break;

              default:
                console.warn("Unhandled action:", actionId);
            }
          }}
          actions={actions}
          shouldOpenOnLongPress={false}
        >
          <IconButton icon="dots-vertical" style={{ margin: 0 }} />
        </MenuView>
      </Row>
    </Card>
  );
};
