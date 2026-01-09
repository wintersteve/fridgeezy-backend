import "reflect-metadata";
import {
    SuggestionGeneratorService,
    SuggestionsService,
} from "@fridgeezy/application";
import { ISuggestionsRepository } from "@fridgeezy/domain";
import { openai } from "@fridgeezy/openai";
import { SuggestionsRepository } from "@fridgeezy/supabase";
import { container } from "tsyringe";

container.register<ISuggestionsRepository>("ISuggestionsRepository", {
    useClass: SuggestionsRepository,
});

container.register(SuggestionsService, { useClass: SuggestionsService });

// Register OpenAI client as singleton
container.registerInstance("OpenAIClient", openai);

// Register SuggestionGeneratorService
container.register(SuggestionGeneratorService, {
    useClass: SuggestionGeneratorService,
});

export { container };
