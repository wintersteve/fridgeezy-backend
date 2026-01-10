import { BottomSheetModal } from "@gorhom/bottom-sheet";
import { RefObject, useRef } from "react";
import { Image, View, Pressable } from "react-native";
import { Icon, Text } from "react-native-paper";

import { useDeletePantryItem } from "@/core/supabase";
import { usePantryItem } from "@/core/supabase/hooks/use-pantry-item";
import { EditPantryItemModal, EditPantryItemModalRef } from "@/features/pantry";
import { useTheme } from "@/shared/theme";
import {
  titleCase,
  formatExpiration,
  formatDateShort,
  isExpired,
} from "@/shared/toolkit";
import { BottomSheet, Card, Row, Badge, ScrollView, Button } from "@/shared/ui";

const DefaultImage = require("@/core/assets/ingredient.png");

export interface IngredientsBottomSheetProps {
  id: string | null;
  ref?: RefObject<BottomSheetModal | null>;
}

export const IngredientsBottomSheet = (props: IngredientsBottomSheetProps) => {
  const { id, ref } = props;

  const theme = useTheme();

  const pantryItem = usePantryItem({ id });

  const deletePantryItem = useDeletePantryItem();

  const editModalRef = useRef<EditPantryItemModalRef>(null);

  console.log(pantryItem.data);

  const cards = [
    {
      id: "category",
      icon: "text",
      title: "Category",
      // body: titleCase(pantryItem.data?.ingredient.categories?.name ?? ""),
      body: "",
    },
    ...(pantryItem
      ? [
          {
            id: "expiration",
            icon: isExpired(pantryItem.data?.expires_at ?? null)
              ? "alert-circle"
              : "calendar",
            title: "Expiration",
            body: formatDateShort(pantryItem.data?.expires_at ?? null),
            editable: true,
          },
        ]
      : []),
    {
      id: "description",
      icon: "text",
      title: "Description",
      body: pantryItem.data?.ingredient?.description ?? "",
    },
    {
      id: "storage",
      icon: "fridge-outline",
      title: "Storage",
      body: pantryItem.data?.ingredient?.storage_tips ?? "",
    },
    {
      id: "shelf_life",
      icon: "clock-outline",
      title: "Shelf Life",
      body: pantryItem.data?.ingredient?.shelf_life ?? "",
    },
  ];

  return (
    <>
      <BottomSheet ref={ref} snapPoints={["70%"]}>
        <ScrollView
          contentContainerStyle={{ alignItems: "center", padding: 24 }}
        >
          <Image
            source={DefaultImage}
            style={{
              borderRadius: 100,
              height: 100,
              width: 100,
              marginBottom: 8,
            }}
          />
          <View style={{ alignItems: "center", marginBottom: 24 }}>
            <Text
              variant="headlineMedium"
              style={{
                textAlign: "center",
              }}
            >
              {titleCase(pantryItem.data?.ingredient.name ?? "")}
            </Text>

            <View style={{ marginTop: 8 }}>
              <Badge>
                {pantryItem.data?.expires_at
                  ? formatExpiration(pantryItem.data.expires_at)
                  : "No Expiration"}
              </Badge>
            </View>
          </View>

          <View style={{ gap: 6, width: "100%" }}>
            {cards.map((card) =>
              card.body ? (
                <Pressable
                  key={card.id}
                  disabled={!card.editable}
                  onPress={() => {
                    if (
                      card.id === "expiration" &&
                      card.editable &&
                      pantryItem
                    ) {
                      editModalRef.current?.open(pantryItem.data ?? null);
                    }
                  }}
                >
                  <Card
                    contentStyle={{ padding: 12 }}
                    style={{ width: "100%" }}
                  >
                    <Row centered spacing={12}>
                      <Icon
                        source={card.icon}
                        size={24}
                        color={
                          card.id === "expiration" &&
                          isExpired(pantryItem.data?.expires_at)
                            ? theme.colors.error
                            : theme.colors.primary
                        }
                      />
                      <View style={{ gap: 2, flex: 1 }}>
                        <Text variant="labelMedium">{card.title}</Text>
                        <Text
                          variant="bodySmall"
                          style={{
                            color:
                              card.id === "expiration" &&
                              isExpired(pantryItem.data?.expires_at)
                                ? theme.colors.error
                                : theme.colors.onSurfaceVariant,
                          }}
                        >
                          {card.body}
                        </Text>
                      </View>
                      {card.editable && (
                        <View style={{ marginRight: 8 }}>
                          <Icon
                            source="pencil"
                            size={16}
                            color={theme.colors.onBackground}
                          />
                        </View>
                      )}
                    </Row>
                  </Card>
                </Pressable>
              ) : null,
            )}
          </View>

          {pantryItem && (
            <View style={{ position: "absolute", top: -16, right: 10 }}>
              <Button
                icon="delete"
                mode="text"
                textColor={theme.colors.error}
                rippleColor={theme.colors.transparent}
                disabled={deletePantryItem.isPending}
                onPress={() => {
                  deletePantryItem.mutate(id, {
                    onSuccess: () => {
                      ref?.current?.dismiss();
                    },
                  });
                }}
              >
                Delete
              </Button>
            </View>
          )}
        </ScrollView>
      </BottomSheet>

      <EditPantryItemModal ref={editModalRef} />
    </>
  );
};
