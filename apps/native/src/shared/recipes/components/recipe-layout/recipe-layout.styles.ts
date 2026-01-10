import { StyleSheet } from "react-native";

export const RECIPE_LAYOUT_IMAGE_HEIGHT = 460;

export const RECIPE_LAYOUT_STYLES = StyleSheet.create({
  HEADER_OVERLAY: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  HEADER_BACKGROUND: {
    ...StyleSheet.absoluteFillObject,
  },
  HEADER_CONTENT: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 8,
    marginBottom: 8,
  },
  BACK_BUTTON: {
    alignItems: "center",
    borderRadius: 22,
    borderWidth: 1,
    justifyContent: "center",
    width: 44,
    height: 44,
  },
  HEADER_TITLE_CONTAINER: {
    flex: 1,
    marginHorizontal: 12,
  },
  HEADER_TITLE: {
    textAlign: "center",
  },
  IMAGE_WRAPPER: {
    height: RECIPE_LAYOUT_IMAGE_HEIGHT,
    overflow: "hidden",
  },
  HERO_IMAGE: {
    width: "100%",
    height: RECIPE_LAYOUT_IMAGE_HEIGHT,
  },
  CARD_OVERLAY: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    marginTop: -24,
    paddingTop: 32,
    minHeight: 400,
  },
  TITLE: {
    textAlign: "center",
    paddingHorizontal: 24,
  },
  DESCRIPTION: {
    textAlign: "center",
    paddingHorizontal: 36,
    marginTop: 8,
  },
  TAGS_CONTAINER: {
    gap: 6,
    justifyContent: "center",
    marginHorizontal: 20,
    marginVertical: 12,
  },
});
