-- Remove the prompts / prompt_variables feature (never wired up).
drop function if exists get_prompt_variable_types();
drop table if exists prompt_variables cascade;
drop table if exists prompts cascade;
drop type if exists prompt_variable_type;
