-- 0004: a profile is its owner's business.
--
-- 0001 let anyone holding the public key read every profile (name, handle,
-- stats), and its "for all" own-row policy let a guest delete their row and
-- insert a fresh one: a reset tally, which 0003's column grants (UPDATE
-- only) did not stop. Nothing needs either policy. Profiles are created by
-- the security-definer trigger public.handle_new_user and renamed by
-- public.handle_user_updated; the server reads and writes them only through
-- the service role; no view, function, policy or broadcast reads another
-- person's row. The triggers (running as their owner), the service role and
-- foreign-key checks are bound neither by RLS nor by the grants below.
--
-- From here a signed-in person may read their own row and update the
-- columns 0003 allows on it, and nothing else. Safe to run more than once.

drop policy if exists "profiles are readable by everyone" on public.profiles;
drop policy if exists "users manage their own profile" on public.profiles;

drop policy if exists "users read their own profile" on public.profiles;
create policy "users read their own profile" on public.profiles
  for select to authenticated
  using (auth.uid() = id);

drop policy if exists "users update their own profile" on public.profiles;
create policy "users update their own profile" on public.profiles
  for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- No insert or delete policy, and no privilege either, so a missing policy
-- is not the only thing in the way. TRUNCATE ignores RLS, so it goes too.
revoke insert, delete, truncate on public.profiles from anon, authenticated;

-- 0003's column grants, restated so this file alone leaves the right
-- privileges whether or not 0003 was run. Revoking UPDATE on the table also
-- revokes it on every column, so the pair always ends in the same place.
revoke update on public.profiles from anon, authenticated;
grant update (display_name, avatar_url, preferences, handle) on public.profiles to authenticated;

-- On since 0001; restated so the policies above are what decides.
alter table public.profiles enable row level security;
