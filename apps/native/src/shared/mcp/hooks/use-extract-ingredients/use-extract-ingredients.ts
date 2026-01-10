import { useMutation } from "@tanstack/react-query";

const mutationFn = async (base64Image?: string) => {
  if (!base64Image) return;

  try {
    const response = await fetch("http://localhost:8000/extract-ingredients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image: base64Image,
        imageType: "base64",
      }),
    });

    return response.json();
  } catch (error) {
    console.error(error);

    return null;
  }
};

export const useExtractIngredients = () => {
  return useMutation({ mutationFn });
};
