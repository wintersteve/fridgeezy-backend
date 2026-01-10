import { ScrollView, Section } from "@/shared/ui";

import { ShoppingLists } from "../../components/shopping-lists";

export const ShoppingListsScreen = () => {
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingTop: 12 }}
    >
      <Section title="Your Shopping lists" style={{ padding: 12 }}>
        <ShoppingLists />
      </Section>
    </ScrollView>
  );
};
