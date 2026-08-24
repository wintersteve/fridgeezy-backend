# components

Deciding which ingredient lines are dishes in disguise: the vocabulary, the
prompt, and the classifier.

A lasagne contains a béchamel. The catalogue already holds components as recipes
(Beurre Blanc, Toum, Arrabbiata Sauce) and as ingredients (Bechamel Sauce, Pizza
Dough, Tomato Sauce) — and nothing joined the two, because nothing in the data
could. Names do not match, and no column separates a thing you make from a thing
you buy: `Bechamel Sauce` and `Soy Sauce` share a category and a null parent.

So it is decided once per ingredient and stored on the row
(`ingredients.component_kind` / `component_dish`, migration 20260823000002).

It exists as a library rather than as a function in either caller because it has
**two** callers that must not be able to disagree:

- `apps/api` classifies each ingredient as it is created
  (`classifyNewIngredientComponents`)
- `apps/database` backfills in bulk
  (`operations/classify-ingredient-component.ts`)

The prompt leans hard toward `bought`, and that is the design. Missing a real
component costs a link nobody notices; offering to make soy sauce is visible,
absurd, and discredits the marker everywhere it is right.

## Building

Run `nx build @fridgeezy/components` to build the library.
