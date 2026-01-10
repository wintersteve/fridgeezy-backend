import { View } from "react-native";
import { Text } from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useIngredientsFilterStore } from "../../src/features/ingredients";
import { useTags } from "../../src/shared/supabase";
import { useTheme } from "../../src/shared/theme";
import { titleCase } from "../../src/shared/toolkit";
import {
    Button,
    Card,
    Chip,
    Row,
    ScrollView,
    Skeleton,
} from "../../src/shared/ui";

const SKELETON_WIDTHS = [80, 70, 70, 90, 85, 100, 75, 95, 70, 90, 100, 74];

export default function Screen() {
    const filterStore = useIngredientsFilterStore();

    const theme = useTheme();

    const tags = useTags("dietary");

    const insets = useSafeAreaInsets();

    return (
        <View
            style={{
                flex: 1,
                paddingHorizontal: 12,
                paddingVertical: 8,
            }}
        >
            <ScrollView style={{ flex: 1 }}>
                <Text
                    variant="headlineMedium"
                    style={{
                        color: theme.colors.onBackgroundVariant,
                        marginLeft: 6,
                        marginBottom: 4,
                    }}
                >
                    {filterStore.blacklist.length} Selected
                </Text>
                <Card contentStyle={{ padding: 12 }}>
                    <Row spacing={6}>
                        {tags.isLoading
                            ? SKELETON_WIDTHS.map((width, index) => (
                                  <Skeleton
                                      key={index}
                                      width={width}
                                      height={32}
                                  />
                              ))
                            : (tags.data?.map((item) => item.name) ?? []).map(
                                  (id) => (
                                      <Chip
                                          key={id}
                                          onPress={() => {
                                              filterStore.setBlacklist(
                                                  filterStore.blacklist.includes(
                                                      id
                                                  )
                                                      ? filterStore.blacklist.filter(
                                                            (item) =>
                                                                item !== id
                                                        )
                                                      : [
                                                            ...filterStore.blacklist,
                                                            id,
                                                        ]
                                              );
                                          }}
                                          selected={filterStore.blacklist.includes(
                                              id
                                          )}
                                      >
                                          {titleCase(id)}
                                      </Chip>
                                  )
                              )}
                    </Row>
                </Card>
            </ScrollView>
            <Button style={{ marginBottom: insets.bottom }}>Confirm</Button>
        </View>
    );
}
