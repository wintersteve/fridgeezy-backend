import "reflect-metadata";
import { SuggestionsService } from "@fridgeezy/application";
import { ISuggestionsRepository } from "@fridgeezy/domain";
import { SuggestionsRepository } from "@fridgeezy/supabase";
import { container } from "tsyringe";

container.register<ISuggestionsRepository>("ISuggestionsRepository", {
    useClass: SuggestionsRepository,
});

container.register(SuggestionsService, { useClass: SuggestionsService });

export { container };
