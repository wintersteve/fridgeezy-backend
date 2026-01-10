# Custom FAB Component

A fully customizable Floating Action Button with expandable actions using React Native Reanimated.

## Features

- 🎨 Fully customizable colors and icons
- ✨ Smooth spring animations
- 📱 Haptic feedback (iOS)
- 🎯 Staggered action animations
- 🌗 Theme-aware styling
- 📍 Customizable positioning

## Usage

### Basic Example

```tsx
import { Fab } from "@/shared/ui";

function MyScreen() {
  const handleCamera = () => {
    console.log("Camera pressed");
  };

  const handleSearch = () => {
    console.log("Search pressed");
  };

  return (
    <Fab
      actions={[
        {
          icon: "camera",
          label: "Take a Picture",
          onPress: handleCamera,
        },
        {
          icon: "magnify",
          label: "Search",
          onPress: handleSearch,
        },
      ]}
    />
  );
}
```

### With State Tracking

```tsx
import { Fab } from "@/shared/ui";

function MyScreen() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Fab
      actions={[
        { icon: "camera", label: "Camera", onPress: () => {} },
        { icon: "magnify", label: "Search", onPress: () => {} },
      ]}
      onStateChange={setIsOpen}
    />
  );
}
```

### Custom Positioning

```tsx
<Fab
  actions={[...]}
  position={{
    bottom: 100,  // Account for tab bar
    right: 16,
  }}
/>
```

### Custom Colors

```tsx
const theme = useTheme();

<Fab
  actions={[
    {
      icon: "camera",
      label: "Camera",
      onPress: () => {},
      color: theme.colors.error,
      backgroundColor: theme.colors.errorContainer,
    },
  ]}
  color={theme.colors.secondary}
  backgroundColor={theme.colors.secondaryContainer}
/>
```

### With Safe Area Insets

```tsx
import { useSafeAreaInsets } from "react-native-safe-area-context";

function MyScreen() {
  const insets = useSafeAreaInsets();
  const TAB_BAR_HEIGHT = 49;

  return (
    <Fab
      actions={[...]}
      position={{
        bottom: TAB_BAR_HEIGHT + insets.bottom,
        right: 16,
      }}
    />
  );
}
```

## API

### `Fab` Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `actions` | `FabAction[]` | **required** | Array of action buttons to display |
| `icon` | `string` | `"plus"` | Icon to show when closed |
| `closeIcon` | `string` | `"close"` | Icon to show when open |
| `color` | `string` | `theme.colors.primary` | Icon color |
| `backgroundColor` | `string` | `theme.colors.primaryContainer` | Button background color |
| `position` | `object` | `{ bottom: 16, right: 16 }` | Absolute positioning |
| `visible` | `boolean` | `true` | Show/hide the FAB |
| `onStateChange` | `(open: boolean) => void` | - | Callback when FAB opens/closes |

### `FabAction` Type

```typescript
interface FabAction {
  icon: string;              // Material Community Icons name
  label: string;             // Text label shown next to the action
  onPress: () => void;       // Handler when action is pressed
  color?: string;            // Optional icon color override
  backgroundColor?: string;  // Optional background color override
}
```

## Animation Details

- **Main button**: Rotates 45° when expanded
- **Action buttons**: Stagger in with 50ms delay between each
- **Backdrop**: Fades in with the actions, dismisses FAB when tapped
- **Spring config**: `{ damping: 15, stiffness: 150 }` for smooth, natural motion

## Notes

- Uses `Portal` from `react-native-paper` for proper layering
- Automatically handles haptic feedback on iOS
- Actions are positioned vertically above the main button
- Each action gets 70px of vertical spacing
