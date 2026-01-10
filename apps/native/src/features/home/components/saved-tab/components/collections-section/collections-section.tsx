import { useRef } from "react";

import { useCollections } from "@/core/supabase";
import { Button, ScrollView, Section, EmptyCard } from "@/shared/ui";

import { CollectionCard } from "../collection-card";
import {
  CreateCollectionBottomSheet,
  CreateCollectionBottomSheetRef,
} from "../create-collection-bottom-sheet";

export const CollectionsSection = () => {
  const bottomSheetRef = useRef<CreateCollectionBottomSheetRef>(null);

  const collections = useCollections();

  const handleNewPress = () => {
    bottomSheetRef.current?.open();
  };

  return (
    <>
      <Section
        title="Collections"
        right={
          <Button mode="text" compact onPress={handleNewPress}>
            + New
          </Button>
        }
        titleStyle={{ paddingHorizontal: 18 }}
        style={{ marginTop: 12, marginBottom: 24 }}
      >
        {(collections.data?.length ?? 0) === 0 ? (
          <EmptyCard
            icon="folder-plus-outline"
            title="No collections yet"
            description="Organize your recipes into custom collections"
            style={{ marginHorizontal: 16 }}
          />
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
          >
            {collections.data?.map((collection) => (
              <CollectionCard key={collection.id} collection={collection} />
            ))}
          </ScrollView>
        )}
      </Section>

      <CreateCollectionBottomSheet ref={bottomSheetRef} />
    </>
  );
};
