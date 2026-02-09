-- Add name_en (English name) column to recipe_suggestions and recipes tables.
-- Used for image generation and file naming where English names produce better results.
ALTER TABLE recipe_suggestions ADD COLUMN name_en TEXT;
ALTER TABLE recipes ADD COLUMN name_en TEXT;
