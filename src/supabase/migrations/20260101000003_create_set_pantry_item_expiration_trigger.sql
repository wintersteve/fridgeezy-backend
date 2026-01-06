-- Create trigger function to auto-calculate expiration dates for pantry items
create or replace function set_pantry_item_expiration()
returns trigger as $$
declare
    ingredient_expires BOOLEAN;
    ingredient_shelf_life INTEGER;
begin
    -- Only auto-calculate if expires_at is not explicitly provided by user
    if NEW.expires_at is null then
        -- Get ingredient's expiration metadata
        select expires_by_default, default_shelf_life_days
        into ingredient_expires, ingredient_shelf_life
        from ingredients
        where id = NEW.ingredient_id;

        -- If ingredient expires by default, calculate expires_at
        if ingredient_expires = true and ingredient_shelf_life is not null then
            NEW.expires_at := NOW() + (ingredient_shelf_life || ' days')::INTERVAL;
        end if;
        -- If ingredient doesn't expire (like water, salt), expires_at remains NULL
    end if;

    return NEW;
end;
$$ language plpgsql;

COMMENT on function set_pantry_item_expiration() is
'Automatically sets expires_at based on ingredient default shelf life if not explicitly provided. Respects user-provided expiration dates.';

-- Apply trigger to pantry_items table
create trigger trigger_set_pantry_item_expiration
    before insert or update on pantry_items
    for each row
    execute function set_pantry_item_expiration();

COMMENT on trigger trigger_set_pantry_item_expiration on pantry_items is
'Auto-calculates expiration date from ingredient defaults when adding/updating pantry items';
