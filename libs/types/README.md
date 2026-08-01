# @fridgeezy/types

Pure database types for Fridgeezy applications, auto-generated from Supabase schema.

## Purpose

This package serves as the single source of truth for all database types in the Fridgeezy application. It contains:

- **database.types.ts**: Auto-generated from Supabase CLI (`supabase gen types typescript`)
- **entities/**: Individual type exports for each database table

## Usage

```typescript
// Import database types
import { Database, Tables, TablesInsert, TablesUpdate } from '@fridgeezy/types';

// Import specific entity types
import { Recipes, RecipeSuggestions } from '@fridgeezy/types';

// Use in your code
const recipe: Recipes = {
  id: '123',
  name: 'Pasta Carbonara',
  // ... other fields
};
```

## Generating Types

When the database schema changes:

1. Update `database.types.ts` from Supabase CLI:
   ```bash
   supabase gen types typescript --project-id YOUR_PROJECT_ID > libs/types/src/database.types.ts
   ```

2. Regenerate entity exports:
   ```bash
   cd libs/types
   npm run generate:types
   ```

This will create/update individual type files for each table in the `entities/` directory.

## Dependencies

This package has **zero dependencies** - it contains only pure TypeScript types.

## Architecture

This package is the foundation of the 3-layer architecture:

```
@fridgeezy/types (pure types - no dependencies)
       ↓
@fridgeezy/domain (business logic, validation, behaviors)
       ↓
@fridgeezy/supabase (infrastructure, repositories)
```
