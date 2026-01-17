import {
    ITagsRepository,
    DomainError,
    failure,
    PersistenceError,
    Result,
    success,
} from "@fridgeezy/domain";
import { Tag, TagInsertPayload } from "@fridgeezy/types";

import { supabase } from "../../client";

export class TagsRepository implements ITagsRepository {
    async findByNames(
        names: string[]
    ): Promise<Result<Map<string, Tag>, DomainError>> {
        try {
            const { data, error } = await supabase
                .from("tags")
                .select("*")
                .in("name", names);

            if (error) {
                return failure(new PersistenceError(error.message));
            }

            const resultMap = new Map<string, Tag>();
            if (data) {
                data.forEach((tag) => {
                    resultMap.set(tag.name, tag as Tag);
                });
            }

            return success(resultMap);
        } catch (error) {
            return failure(
                new PersistenceError(
                    `Failed to find tags by names: ${error instanceof Error ? error.message : String(error)}`
                )
            );
        }
    }

    async create(tag: TagInsertPayload): Promise<Result<Tag, DomainError>> {
        try {
            const { data, error } = await supabase
                .from("tags")
                .insert(tag)
                .select()
                .single();

            if (error) {
                return failure(new PersistenceError(error.message));
            }

            return success(data as Tag);
        } catch (error) {
            return failure(
                new PersistenceError(
                    `Failed to create tag: ${error instanceof Error ? error.message : String(error)}`
                )
            );
        }
    }
}
