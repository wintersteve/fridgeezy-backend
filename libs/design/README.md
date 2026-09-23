# @fridgeezy/design

The shared look of the two WEB surfaces — the marketing site (`apps/site`) and
the admin console (`apps/admin`). Both render MUI from the one theme here.

- `tokens.ts` — the single copy of the palette, radii and shadows, plus
  `cssVariables()` for the stylesheets that are still hand-written.
- `theme.ts` — the MUI theme, derived from those tokens. **Neither surface may
  call `createTheme` itself.**
- `fonts.ts` — the `@font-face` rules and the preload tags, parameterised by
  where each surface serves the files from.
- `components.tsx` — the handful of components with a real caller on BOTH
  surfaces. Read its header before adding one.

The values originate in the client app's design system
(`fridgeezy/src/shared/theme/constants`) and are still decided there; this is
the web side's single copy of them, not a second source of truth.
