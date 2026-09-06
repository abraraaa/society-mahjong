-- 0003: the columns a person may write on their own profile.
--
-- RLS lets a signed-in user update their own row; without column privileges
-- that includes stats and onboarding_stage, which the live table reads to set
-- its clocks. A player could reset their tally after every hand and keep every
-- table they sit at on first-timer timers, or store anything at all in the
-- JSON. From here the browser may change only what is theirs to change; the
-- service-role client, which writes the tally, is unaffected.
revoke update on public.profiles from anon, authenticated;
grant update (display_name, avatar_url, preferences, handle) on public.profiles to authenticated;
