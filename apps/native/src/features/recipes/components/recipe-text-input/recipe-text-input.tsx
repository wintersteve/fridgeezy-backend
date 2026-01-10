import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";

import { useDebounce } from "@/shared/toolkit";
import { TextInput, TextInputProps } from "@/shared/ui";

export interface RecipeTextInputProps extends TextInputProps {
  onSubmit?: VoidFunction;
  onSearch?: (text: string) => void | Promise<void>;
}

export const RecipeTextInput = (props: RecipeTextInputProps) => {
  const { onSubmit, onSearch, ...rest } = props;

  const router = useRouter();

  const [query, setQuery] = useState("");

  const { debounce } = useDebounce(300);

  const handleSubmit = () => {
    if (!query.trim()) return;
    router.push(`/recipes/search?query=${encodeURIComponent(query)}`);
    onSubmit?.();
  };

  const handleChange = (text: string) => {
    setQuery(text);

    if (text.length > 2 && onSearch) {
      debounce(onSearch, text);
    }
  };

  useFocusEffect(
    useCallback(() => {
      setQuery("");
    }, []),
  );

  return (
    <TextInput
      label="Ask anything"
      icon="magnify"
      returnKeyType="search"
      value={query}
      onChangeText={handleChange}
      onSubmitEditing={handleSubmit}
      {...rest}
    />
  );
};
