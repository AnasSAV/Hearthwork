-- =============================================================================================
-- Layered avatars (LimeZu character generator). Replaces the old { body: 0-5 } avatar with
-- { v: 2, body, eyes, outfit, hair, acc } part indices; acc = -1 means no accessory.
-- The ranges mirror the part counts in shared/src/avatarParts.ts (checked by avatar.test.ts).
-- Old avatars stay in place; the client asks those players to make a new character.
-- =============================================================================================

create or replace function public.update_profile(p_username text, p_avatar jsonb)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.profiles;
  v_part record;
  v_value numeric;
  v_avatar jsonb := jsonb_build_object('v', 2);
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_username is null or p_username !~ '^[A-Za-z0-9_]{3,16}$' then
    raise exception 'username must be 3-16 letters, digits or underscores' using errcode = '22023';
  end if;
  -- "is distinct from": a missing key gives NULL, which a plain <> would let through.
  if jsonb_typeof(p_avatar) is distinct from 'object'
     or (p_avatar -> 'v') is distinct from '2'::jsonb then
    raise exception 'avatar must be a v2 avatar' using errcode = '22023';
  end if;

  for v_part in
    select * from (values
      ('body', 0, 8), ('eyes', 0, 6), ('outfit', 0, 131), ('hair', 0, 199), ('acc', -1, 83)
    ) as parts(name, lo, hi)
  loop
    if jsonb_typeof(p_avatar -> v_part.name) is distinct from 'number' then
      raise exception 'avatar.% must be a number', v_part.name using errcode = '22023';
    end if;
    v_value := (p_avatar ->> v_part.name)::numeric;
    if v_value <> trunc(v_value) or v_value < v_part.lo or v_value > v_part.hi then
      raise exception 'avatar.% must be an integer %-%', v_part.name, v_part.lo, v_part.hi
        using errcode = '22023';
    end if;
    v_avatar := v_avatar || jsonb_build_object(v_part.name, v_value::int);
  end loop;

  begin
    update public.profiles
       set username = p_username,
           avatar = v_avatar
     where id = v_uid
    returning * into v_row;
  exception when unique_violation then
    raise exception 'username is taken' using errcode = '23505';
  end;
  return v_row;
end;
$$;
