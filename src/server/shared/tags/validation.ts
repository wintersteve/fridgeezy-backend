import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
// Note: You may need to adjust this based on your actual Supabase client setup
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Validates that parent_id references a tag of the same type
 *
 * @param tagType - The type of the child tag
 * @param parentId - The UUID of the parent tag
 * @returns Validation result with error message if invalid
 */
export async function validateTagParent(
    tagType: string,
    parentId: string
): Promise<{ valid: boolean; error?: string }> {
    const { data, error } = await supabase
        .from('tags')
        .select('type')
        .eq('id', parentId)
        .single();

    if (error || !data) {
        return { valid: false, error: 'Parent tag not found' };
    }

    if (data.type !== tagType) {
        return {
            valid: false,
            error: `Parent tag type '${data.type}' does not match tag type '${tagType}'`,
        };
    }

    return { valid: true };
}

/**
 * Detects circular parent relationships by traversing up the hierarchy
 *
 * @param tagId - The UUID of the child tag
 * @param parentId - The UUID of the proposed parent tag
 * @param maxDepth - Maximum hierarchy depth to prevent infinite loops (default: 10)
 * @returns Detection result with error message if circular reference found
 */
export async function detectCircularParent(
    tagId: string,
    parentId: string,
    maxDepth: number = 10
): Promise<{ circular: boolean; error?: string }> {
    let currentId = parentId;
    let depth = 0;

    while (currentId && depth < maxDepth) {
        // Check if we've reached the original tag (circular reference)
        if (currentId === tagId) {
            return {
                circular: true,
                error: 'Circular parent relationship detected'
            };
        }

        // Get the parent of the current tag
        const { data, error } = await supabase
            .from('tags')
            .select('parent_id')
            .eq('id', currentId)
            .single();

        if (error || !data) break;

        currentId = data.parent_id;
        depth++;
    }

    if (depth >= maxDepth) {
        return {
            circular: true,
            error: 'Maximum hierarchy depth exceeded'
        };
    }

    return { circular: false };
}

/**
 * Gets all ancestors of a tag (parent, grandparent, etc.)
 *
 * @param tagId - The UUID of the tag
 * @param maxDepth - Maximum hierarchy depth (default: 10)
 * @returns Array of ancestor tag IDs from immediate parent to root
 */
export async function getTagAncestors(
    tagId: string,
    maxDepth: number = 10
): Promise<string[]> {
    const ancestors: string[] = [];
    let currentId = tagId;
    let depth = 0;

    while (currentId && depth < maxDepth) {
        const { data } = await supabase
            .from('tags')
            .select('parent_id')
            .eq('id', currentId)
            .single();

        if (!data?.parent_id) break;

        ancestors.push(data.parent_id);
        currentId = data.parent_id;
        depth++;
    }

    return ancestors;
}

/**
 * Gets all descendants of a tag (children, grandchildren, etc.)
 * Note: This is a simple implementation that only returns direct children.
 * For full recursive descendant queries, use the database function get_tag_descendants()
 *
 * @param tagId - The UUID of the tag
 * @returns Array of direct child tag IDs
 */
export async function getTagDescendants(tagId: string): Promise<string[]> {
    const { data } = await supabase
        .from('tags')
        .select('id')
        .eq('parent_id', tagId);

    return data?.map(tag => tag.id) || [];
}

/**
 * Validates a tag before insert/update with parent_id
 * Combines type validation and circular reference detection
 *
 * @param tagId - The UUID of the tag (use null for new inserts)
 * @param tagType - The type of the tag
 * @param parentId - The UUID of the parent tag (can be null)
 * @returns Validation result with error message if invalid
 */
export async function validateTagWithParent(
    tagId: string | null,
    tagType: string,
    parentId: string | null
): Promise<{ valid: boolean; error?: string }> {
    // If no parent, validation passes
    if (!parentId) {
        return { valid: true };
    }

    // Validate parent has same type
    const typeValidation = await validateTagParent(tagType, parentId);
    if (!typeValidation.valid) {
        return typeValidation;
    }

    // Only check for circular references on updates (when tagId exists)
    if (tagId) {
        const circularCheck = await detectCircularParent(tagId, parentId);
        if (circularCheck.circular) {
            return { valid: false, error: circularCheck.error };
        }
    }

    return { valid: true };
}
