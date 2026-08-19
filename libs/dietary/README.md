# dietary

Ingredient dietary-property classification: the vocabulary, the prompt, and the
classifier.

It exists as a library rather than as a function in either caller because it has
**two** callers that must not be able to disagree:

- `apps/api` classifies each ingredient as it is created (`classifyNewIngredients`)
- `apps/database` backfills in bulk (`operations/classify-ingredient-diet.ts`)

The prompt is safety-critical — it is what a nut-allergy filter is ultimately
derived from — and several of its rules are worded the way they are because a
shorter wording produced a measured false negative. Two copies drifting apart
would be invisible until someone was told a dish was free of something it
contains.

It labels objective **properties** ("does this contain dairy"), never diets ("is
this vegan"). The diets are assembled from the properties in SQL by
`dietary_rules`.

## Building

Run `nx build @fridgeezy/dietary` to build the library.
