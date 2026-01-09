import "reflect-metadata";
import { SuggestionsService } from "@fridgeezy/application";
import { ISuggestionsRepository } from "@fridgeezy/domain";
import { SuggestionsRepository } from "@fridgeezy/supabase";
import { container } from "tsyringe";

/**
 * Dependency Injection Container Configuration
 *
 * This file sets up tsyringe DI container with all application dependencies.
 * Import this file early in main.ts to ensure DI is configured before resolving dependencies.
 */

// Register SuggestionsRepository as singleton implementation of ISuggestionsRepository
container.register<ISuggestionsRepository>("ISuggestionsRepository", {
    useClass: SuggestionsRepository,
});

// Register SuggestionsService as singleton
container.register(SuggestionsService, {
    useClass: SuggestionsService,
});

export { container };
