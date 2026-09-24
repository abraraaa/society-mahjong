import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/*
 * docs/ops/funnel.sql is pasted into the Supabase SQL editor by hand, where a
 * typo in a column name only shows up as an error on the night someone wants
 * the numbers. These tests read it next to supabase/schema.sql: it must only
 * ever read, and every column it names on rooms, games, hand_results and
 * profiles must exist there.
 */

const ROOT = new URL('../../../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), 'utf8');
const withoutComments = (sql: string) => sql.replace(/--[^\n]*/g, '');

const FUNNEL = withoutComments(read('docs/ops/funnel.sql'));
/** The alias each query in funnel.sql gives each table. */
const ALIASES: Record<string, string> = { r: 'rooms', g: 'games', h: 'hand_results', p: 'profiles' };

/** Columns per public table, replaying the schema's create table, add column, rename column and drop table statements in order. */
function schemaColumns(sql: string): Map<string, Set<string>> {
  const tables = new Map<string, Set<string>>();
  const statements = withoutComments(sql)
    .split(/(\$\$[\s\S]*?\$\$)/)
    .filter((_, i) => i % 2 === 0)
    .join('')
    .split(';');
  for (const raw of statements) {
    const s = raw.replace(/\s+/g, ' ').trim().toLowerCase();
    const created = /^create table public\.(\w+) \((.*)\)$/.exec(s);
    if (created) {
      const cols = created[2]!
        .split(/,(?![^(]*\))/)
        .map((part) => part.trim().split(' ')[0]!)
        .filter((word) => !['primary', 'constraint', 'unique', 'foreign', 'check'].includes(word));
      tables.set(created[1]!, new Set(cols));
      continue;
    }
    const dropped = /^drop table if exists public\.(\w+)$/.exec(s);
    if (dropped) tables.delete(dropped[1]!);
    const altered = /^alter table public\.(\w+) (.*)$/.exec(s);
    if (!altered) continue;
    const cols = tables.get(altered[1]!);
    if (!cols) continue;
    for (const m of altered[2]!.matchAll(/add column (?:if not exists )?(\w+)/g)) cols.add(m[1]!);
    for (const m of altered[2]!.matchAll(/rename column (\w+) to (\w+)/g)) {
      cols.delete(m[1]!);
      cols.add(m[2]!);
    }
  }
  return tables;
}

describe('docs/ops/funnel.sql', () => {
  it('only reads: every statement is a select, and nothing in it writes, locks or grants', () => {
    const statements = FUNNEL.split(';')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    expect(statements.length).toBeGreaterThanOrEqual(7);
    for (const s of statements) expect(s).toMatch(/^(select|with)\b/);
    expect(FUNNEL.toLowerCase()).not.toMatch(/\b(insert|update|delete|merge|upsert|truncate|drop|alter|create|grant|revoke|lock|for update|call|do)\b/);
  });

  it('names only columns that supabase/schema.sql gives those tables', () => {
    const tables = schemaColumns(read('supabase/schema.sql'));
    const used = [...FUNNEL.matchAll(/\b([rghp])\.(\w+)\b/g)].map(([, alias, col]) => [ALIASES[alias!]!, col!] as const);
    expect(used.length).toBeGreaterThan(20);
    const missing = used.filter(([table, col]) => !tables.get(table)?.has(col)).map(([table, col]) => `${table}.${col}`);
    expect(missing).toEqual([]);
  });

  it('reads the tables under the aliases the checks above expect', () => {
    for (const [alias, table] of Object.entries(ALIASES)) {
      const froms = [...FUNNEL.matchAll(new RegExp(`\\bpublic\\.${table} (\\w+)`, 'g'))].map((m) => m[1]);
      expect(froms.length, `${table} is read somewhere`).toBeGreaterThan(0);
      expect(new Set(froms), `${table} is always "${alias}"`).toEqual(new Set([alias]));
    }
  });
});
