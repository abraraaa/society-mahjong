import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/*
 * There's no database here, so these tests read the SQL itself: supabase/schema.sql,
 * the full picture for a fresh project, and the migrations an existing project runs.
 * They replay the statements that decide who may see and change a profile (its
 * policies and its grants) the way Postgres applies them, and check that nothing
 * else in the schema reads profiles.
 */

const SUPABASE = new URL('../../../../supabase/', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, SUPABASE), 'utf8');
const MIGRATIONS = readdirSync(new URL('migrations/', SUPABASE))
  .filter((f) => f.endsWith('.sql'))
  .sort();

function migration(prefix: string): string {
  const file = MIGRATIONS.find((f) => f.startsWith(prefix));
  if (!file) throw new Error(`no migration ${prefix}`);
  return read(`migrations/${file}`);
}

/** Statements, one line each and lower-cased, with comments gone and dollar-quoted bodies kept whole. */
function split(sql: string): string[] {
  const out: string[] = [];
  let current = '';
  sql
    .replace(/--[^\n]*/g, '')
    .split(/(\$\$[\s\S]*?\$\$)/)
    .forEach((part, i) => {
      if (i % 2 === 1) {
        current += part;
        return;
      }
      const [first = '', ...rest] = part.split(';');
      current += first;
      for (const piece of rest) {
        out.push(current);
        current = piece;
      }
    });
  out.push(current);
  return out.map((s) => s.replace(/\s+/g, ' ').trim().toLowerCase()).filter(Boolean);
}

type Role = 'anon' | 'authenticated';
const ROLES: readonly Role[] = ['anon', 'authenticated'];
/** Supabase grants every table privilege to anon and authenticated on each new table in public. */
const SUPABASE_DEFAULT = ['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'];

interface ProfileAccess {
  rls: boolean;
  /** policy name → the rest of its create statement, e.g. "for select to authenticated using (...)" */
  readonly policies: Map<string, string>;
  /** privileges held on the whole table */
  readonly table: Record<Role, Set<string>>;
  /** columns granted UPDATE one by one */
  readonly updatable: Record<Role, Set<string>>;
}

function fresh(): ProfileAccess {
  return {
    rls: false,
    policies: new Map(),
    table: { anon: new Set(SUPABASE_DEFAULT), authenticated: new Set(SUPABASE_DEFAULT) },
    updatable: { anon: new Set(), authenticated: new Set() },
  };
}

function grantees(text: string): Role[] {
  return text
    .split(',')
    .map((r) => r.trim())
    .filter((r) => r !== 'service_role')
    .map((r) => {
      if (!ROLES.includes(r as Role)) throw new Error(`this replay does not model grants to ${r}`);
      return r as Role;
    });
}

/** Apply the profile statements in `sql` to `access`, refusing what Postgres would refuse. */
function replay(sql: string, access: ProfileAccess = fresh()): ProfileAccess {
  for (const s of split(sql)) {
    const create = s.match(/^create policy "([^"]+)" on public\.profiles (.*)$/);
    if (create) {
      const [, name = '', rest = ''] = create;
      if (access.policies.has(name)) throw new Error(`policy "${name}" for table "profiles" already exists`);
      access.policies.set(name, rest);
      continue;
    }
    const drop = s.match(/^drop policy (if exists )?"([^"]+)" on public\.profiles$/);
    if (drop) {
      const [, ifExists, name = ''] = drop;
      if (!access.policies.delete(name) && !ifExists) throw new Error(`policy "${name}" for table "profiles" does not exist`);
      continue;
    }
    const grant = s.match(/^(grant|revoke) (.+) on (?:table )?public\.profiles (?:to|from) (.+)$/);
    if (grant) {
      const [, verb, privileges = '', roles = ''] = grant;
      const columns = privileges.match(/^update \(([^)]*)\)$/);
      for (const role of grantees(roles)) {
        if (columns) {
          for (const column of (columns[1] ?? '').split(',').map((c) => c.trim())) {
            if (verb === 'grant') access.updatable[role].add(column);
            else access.updatable[role].delete(column);
          }
          continue;
        }
        for (const p of privileges.split(',').map((x) => x.trim())) {
          if (p.includes('(')) throw new Error(`this replay does not model column grants of ${p}`);
          for (const privilege of p === 'all' || p === 'all privileges' ? SUPABASE_DEFAULT : [p]) {
            if (verb === 'grant') {
              access.table[role].add(privilege);
            } else {
              access.table[role].delete(privilege);
              // Revoking a privilege on the table revokes it on every column too.
              if (privilege === 'update') access.updatable[role].clear();
            }
          }
        }
      }
      continue;
    }
    if (s === 'alter table public.profiles enable row level security') access.rls = true;
    else if (s === 'alter table public.profiles disable row level security') access.rls = false;
    else if (/^(create policy|drop policy|grant|revoke|alter table public\.profiles (enable|disable|force|no force) row)/.test(s) && /\bpublic\.profiles\b/.test(s)) {
      throw new Error(`this replay does not understand: ${s}`);
    }
  }
  return access;
}

function summary(access: ProfileAccess) {
  const sorted = (set: Set<string>) => [...set].sort();
  return {
    rls: access.rls,
    policies: Object.fromEntries([...access.policies].sort(([a], [b]) => a.localeCompare(b))),
    anon: { table: sorted(access.table.anon), updatable: sorted(access.updatable.anon) },
    authenticated: { table: sorted(access.table.authenticated), updatable: sorted(access.updatable.authenticated) },
  };
}

const SCHEMA = read('schema.sql');
const OWN_ROW_POLICIES = {
  'users read their own profile': 'for select to authenticated using (auth.uid() = id)',
  'users update their own profile': 'for update to authenticated using (auth.uid() = id) with check (auth.uid() = id)',
};

describe('supabase/schema.sql', () => {
  it('holds every migration, word for word and in order', () => {
    expect(MIGRATIONS.slice(0, 4)).toEqual(['0001_init.sql', '0002_rooms_games_live.sql', '0003_profile_columns.sql', '0004_profiles_private.sql']);
    let from = 0;
    for (const file of MIGRATIONS) {
      const text = read(`migrations/${file}`).trim();
      const at = SCHEMA.indexOf(text, from);
      expect(at, `${file} is missing from schema.sql, or out of order`).toBeGreaterThanOrEqual(from);
      from = at + text.length;
    }
  });
});

describe('who may see and change a profile', () => {
  it('before 0004, anyone could read every profile, and a guest could delete and re-insert their own', () => {
    const before = replay([migration('0001'), migration('0002'), migration('0003')].join('\n'));
    expect([...before.policies.values()]).toContain('for select using (true)');
    expect([...before.policies.values()]).toContain('for all using (auth.uid() = id) with check (auth.uid() = id)');
    expect(before.table.authenticated).toContain('insert');
    expect(before.table.authenticated).toContain('delete');
  });

  it('after the full schema, a signed-in person may read and update their own row and no other', () => {
    const after = summary(replay(SCHEMA));
    expect(after.rls).toBe(true);
    expect(after.policies).toEqual(OWN_ROW_POLICIES);
  });

  it('nobody but the server inserts, deletes or truncates a profile, and a guest may update only the columns 0003 allows', () => {
    const after = replay(SCHEMA);
    for (const role of ROLES) {
      for (const privilege of ['insert', 'delete', 'truncate', 'update']) expect(after.table[role], `${role} ${privilege}`).not.toContain(privilege);
    }
    expect([...after.updatable.authenticated].sort()).toEqual(['avatar_url', 'display_name', 'handle', 'preferences']);
    expect([...after.updatable.anon]).toEqual([]);
    // Own-row reads still need SELECT on the table; the policy decides which row.
    expect(after.table.authenticated).toContain('select');
  });

  it('0004 runs a second time without error and changes nothing', () => {
    const once = summary(replay(SCHEMA));
    const twice = summary(replay(migration('0004'), replay(SCHEMA)));
    expect(twice).toEqual(once);
  });

  it('0004 leaves the same access whether or not 0003 ran first', () => {
    const skipped = summary(replay([migration('0001'), migration('0002'), migration('0004')].join('\n')));
    expect(skipped).toEqual(summary(replay(SCHEMA)));
  });

  it('the replay refuses what Postgres refuses, so the idempotence checks mean something', () => {
    const twoCreates = 'create policy "p" on public.profiles for select using (true); create policy "p" on public.profiles for select using (true);';
    expect(() => replay(twoCreates)).toThrow(/already exists/);
    expect(() => replay('drop policy "p" on public.profiles;')).toThrow(/does not exist/);
    expect(() => replay('grant select on public.profiles to public;')).toThrow(/does not model/);
  });
});

describe('what reads profiles', () => {
  it('nothing in the schema but the two sign-up triggers and the host foreign key touches profiles: no view, function or other policy', () => {
    const allowed = [
      /^create table public\.profiles \(/,
      /^alter table public\.profiles /,
      /^(create|drop) policy (if exists )?"[^"]+" on public\.profiles\b/,
      /^(grant|revoke) .+ on public\.profiles (to|from) /,
      // A foreign-key check is made by Postgres itself and is not bound by RLS.
      /^create table public\.rooms \(.* host_id uuid not null references public\.profiles \(id\),/,
      // Security definer: each writes only the row of the auth user that fired it (new.id).
      /^create or replace function public\.handle_new_user\(\) returns trigger language plpgsql security definer /,
      /^create or replace function public\.handle_user_updated\(\) returns trigger language plpgsql security definer /,
    ];
    const touching = split(SCHEMA).filter((s) => /\bprofiles\b/.test(s));
    expect(touching.length).toBeGreaterThan(0);
    expect(touching.filter((s) => !allowed.some((re) => re.test(s)))).toEqual([]);
  });
});
