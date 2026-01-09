import { Result } from '../shared/result';
import { DomainError } from '../shared/base-error';

/**
 * Base repository interface defining standard CRUD operations.
 * All domain repositories should implement or extend this interface.
 *
 * @template TEntity The entity type this repository manages
 * @template TId The type of the entity's identifier (defaults to string)
 *
 * @example
 * ```typescript
 * interface IRecipeRepository extends IBaseRepository<Recipe, string> {
 *   findByName(name: string): Promise<Result<Recipe | null, DomainError>>;
 * }
 * ```
 */
export interface IBaseRepository<TEntity, TId = string> {
  /**
   * Find an entity by its identifier
   */
  findById(id: TId): Promise<Result<TEntity | null, DomainError>>;

  /**
   * Find all entities (use with caution for large datasets)
   * Consider using findMany with pagination instead
   */
  findAll(): Promise<Result<TEntity[], DomainError>>;

  /**
   * Create a new entity
   */
  create(entity: Omit<TEntity, 'id' | 'createdAt'>): Promise<Result<TEntity, DomainError>>;

  /**
   * Update an existing entity
   */
  update(id: TId, data: Partial<TEntity>): Promise<Result<TEntity, DomainError>>;

  /**
   * Delete an entity by its identifier
   */
  delete(id: TId): Promise<Result<void, DomainError>>;
}

/**
 * Query options for filtering, pagination, and sorting
 */
export interface QueryOptions {
  /**
   * Maximum number of records to return
   */
  limit?: number;

  /**
   * Number of records to skip
   */
  offset?: number;

  /**
   * Field to order by
   */
  orderBy?: string;

  /**
   * Sort order
   */
  order?: 'asc' | 'desc';
}

/**
 * Extended repository interface with pagination support
 */
export interface IPaginatedRepository<TEntity, TId = string>
  extends IBaseRepository<TEntity, TId> {
  /**
   * Find entities with pagination and filtering
   */
  findMany(options: QueryOptions): Promise<Result<TEntity[], DomainError>>;

  /**
   * Count total number of entities (useful for pagination)
   */
  count(): Promise<Result<number, DomainError>>;
}
