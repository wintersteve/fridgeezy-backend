import { toSnake } from "ts-case-convert";

import { Suggestion } from "../../../domain";
import { GenerateSuggestionResponseDto } from "../../dtos";

export class SuggestionsMapper {
    static fromLLM(dto: GenerateSuggestionResponseDto) {
        const normalized = {
            ...dto,
            ingredients: dto.ingredients.map(toSnake),
        };

        return Suggestion.create(normalized);
    }

    static toPersistence() {}
}
