/**
 * Database client — uses local Postgres directly via pg.
 * Exposes a Supabase-compatible query builder so all existing
 * tRPC routers and workers work without changes.
 */

import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.SUPABASE_DB_URL,
});

// ── Supabase-compatible query builder ─────────────────────────────────────────

type FilterOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'is' | 'in' | 'not_is' | 'not_in';

interface Filter {
  col: string;
  op: FilterOp;
  val: unknown;
}

class QueryBuilder {
  private _table: string;
  private _select = '*';
  private _filters: Filter[] = [];
  private _orFilters: string[] = [];
  private _order: { col: string; asc: boolean } | null = null;
  private _limit: number | null = null;
  private _single = false;
  private _insertData: Record<string, unknown> | Record<string, unknown>[] | null = null;
  private _updateData: Record<string, unknown> | null = null;
  private _upsertData: Record<string, unknown> | Record<string, unknown>[] | null = null;
  private _upsertConflict: string | null = null;
  private _delete = false;
  private _returning = false;

  constructor(table: string) {
    this._table = table;
  }

  select(cols: string = '*') { this._select = cols; this._returning = true; return this; }
  eq(col: string, val: unknown) { this._filters.push({ col, op: 'eq', val }); return this; }
  neq(col: string, val: unknown) { this._filters.push({ col, op: 'neq', val }); return this; }
  gt(col: string, val: unknown) { this._filters.push({ col, op: 'gt', val }); return this; }
  gte(col: string, val: unknown) { this._filters.push({ col, op: 'gte', val }); return this; }
  lt(col: string, val: unknown) { this._filters.push({ col, op: 'lt', val }); return this; }
  lte(col: string, val: unknown) { this._filters.push({ col, op: 'lte', val }); return this; }
  is(col: string, val: unknown) { this._filters.push({ col, op: 'is', val }); return this; }
  in(col: string, val: unknown[]) { this._filters.push({ col, op: 'in', val }); return this; }
  not(col: string, op: string, val: unknown) {
    if (op === 'is') this._filters.push({ col, op: 'not_is', val });
    else if (op === 'in') this._filters.push({ col, op: 'not_in', val });
    else this._filters.push({ col, op: 'neq', val });
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) { this._order = { col, asc: opts?.ascending ?? true }; return this; }
  limit(n: number) { this._limit = n; return this; }
  single() { this._single = true; return this; }
  maybeSingle() { this._single = true; return this; }

  or(expr: string) { this._orFilters.push(expr); return this; }

  insert(data: Record<string, unknown> | Record<string, unknown>[]) {
    this._insertData = data;
    return this;
  }

  update(data: Record<string, unknown>) {
    this._updateData = data;
    return this;
  }

  upsert(data: Record<string, unknown> | Record<string, unknown>[], opts?: { onConflict?: string }) {
    this._upsertData = data;
    this._upsertConflict = opts?.onConflict ?? null;
    return this;
  }

  delete() { this._delete = true; return this; }

  private buildWhere(params: unknown[]): string {
    const clauses: string[] = [];
    const p = (val: unknown) => { params.push(val); return '$' + params.length; };

    for (const f of this._filters) {
      if (f.op === 'is') {
        clauses.push('"' + f.col + '" IS ' + (f.val === null ? 'NULL' : 'NOT NULL'));
      } else if (f.op === 'not_is') {
        clauses.push('"' + f.col + '" IS ' + (f.val === null ? 'NOT NULL' : 'NULL'));
      } else if (f.op === 'in' && Array.isArray(f.val)) {
        const placeholders = (f.val as unknown[]).map(v => p(v)).join(', ');
        clauses.push('"' + f.col + '" IN (' + placeholders + ')');
      } else if (f.op === 'not_in') {
        if (Array.isArray(f.val)) {
          const placeholders = (f.val as unknown[]).map(v => p(v)).join(', ');
          clauses.push('"' + f.col + '" NOT IN (' + placeholders + ')');
        } else {
          // Raw string like '("applied","rejected")' passed from Supabase-style .not()
          clauses.push('"' + f.col + '" NOT IN ' + String(f.val));
        }
      } else {
        const opMap: Record<string, string> = { eq: '=', neq: '!=', gt: '>', gte: '>=', lt: '<', lte: '<=' };
        clauses.push('"' + f.col + '" ' + (opMap[f.op] ?? '=') + ' ' + p(f.val));
      }
    }

    // Parse or() expressions like "indexable.eq.true,indexable.is.null"
    for (const orExpr of this._orFilters) {
      const parts = orExpr.split(',').map(part => {
        const [col, op, ...rest] = part.trim().split('.');
        const val = rest.join('.');
        if (op === 'is' && val === 'null') return '"' + col + '" IS NULL';
        if (op === 'eq') {
          const v = val === 'true' ? true : val === 'false' ? false : val;
          return '"' + col + '" = ' + p(v);
        }
        return '"' + col + '" IS NULL';
      });
      clauses.push('(' + parts.join(' OR ') + ')');
    }

    return clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  }

  async then(resolve: (v: { data: unknown; error: null | { message: string } }) => void) {
    try {
      const result = await this._execute();
      resolve(result);
    } catch (err: any) {
      resolve({ data: null, error: { message: err.message } });
    }
  }

  private async _execute(): Promise<{ data: unknown; error: null | { message: string } }> {
    const params: unknown[] = [];
    const p = (val: unknown) => { params.push(val); return '$' + params.length; };

    // INSERT
    if (this._insertData !== null) {
      const rows = Array.isArray(this._insertData) ? this._insertData : [this._insertData];
      if (rows.length === 0) return { data: [], error: null };
      const cols = Object.keys(rows[0]);
      const colList = cols.map(c => '"' + c + '"').join(', ');
      const valueSets = rows.map(row => '(' + cols.map(c => p(row[c])).join(', ') + ')');
      const returning = this._returning || this._single ? 'RETURNING ' + (this._select === '*' ? '*' : this._select) : '';
      const sql = 'INSERT INTO "' + this._table + '" (' + colList + ') VALUES ' + valueSets.join(', ') + ' ' + returning;
      const res = await pool.query(sql, params);
      return { data: this._single ? (res.rows[0] ?? null) : res.rows, error: null };
    }

    // UPSERT
    if (this._upsertData !== null) {
      const rows = Array.isArray(this._upsertData) ? this._upsertData : [this._upsertData];
      if (rows.length === 0) return { data: [], error: null };
      const cols = Object.keys(rows[0]);
      const colList = cols.map(c => '"' + c + '"').join(', ');
      const valueSets = rows.map(row => '(' + cols.map(c => p(row[c])).join(', ') + ')');
      const conflict = this._upsertConflict
        ? 'ON CONFLICT (' + this._upsertConflict.split(',').map(c => '"' + c.trim() + '"').join(', ') + ') DO UPDATE SET ' +
          cols.filter(c => !this._upsertConflict!.includes(c)).map(c => '"' + c + '" = EXCLUDED."' + c + '"').join(', ')
        : 'ON CONFLICT DO NOTHING';
      const returning = this._returning || this._single ? 'RETURNING ' + (this._select === '*' ? '*' : this._select) : '';
      const sql = 'INSERT INTO "' + this._table + '" (' + colList + ') VALUES ' + valueSets.join(', ') + ' ' + conflict + ' ' + returning;
      const res = await pool.query(sql, params);
      return { data: this._single ? (res.rows[0] ?? null) : res.rows, error: null };
    }

    // UPDATE
    if (this._updateData !== null) {
      const cols = Object.keys(this._updateData);
      const setClauses = cols.map(c => '"' + c + '" = ' + p(this._updateData![c])).join(', ');
      const where = this.buildWhere(params);
      const returning = this._returning || this._single ? 'RETURNING ' + (this._select === '*' ? '*' : this._select) : '';
      const sql = 'UPDATE "' + this._table + '" SET ' + setClauses + ' ' + where + ' ' + returning;
      const res = await pool.query(sql, params);
      return { data: this._single ? (res.rows[0] ?? null) : res.rows, error: null };
    }

    // DELETE
    if (this._delete) {
      const where = this.buildWhere(params);
      const sql = 'DELETE FROM "' + this._table + '" ' + where;
      await pool.query(sql, params);
      return { data: null, error: null };
    }

    // SELECT
    const where = this.buildWhere(params);
    const orderClause = this._order ? 'ORDER BY "' + this._order.col + '" ' + (this._order.asc ? 'ASC' : 'DESC') : '';
    const limitClause = this._limit ? 'LIMIT ' + this._limit : '';
    const sql = 'SELECT ' + (this._select === '*' ? '*' : this._select) + ' FROM "' + this._table + '" ' + where + ' ' + orderClause + ' ' + limitClause;
    const res = await pool.query(sql, params);
    return { data: this._single ? (res.rows[0] ?? null) : res.rows, error: null };
  }
}

// ── Client factory ────────────────────────────────────────────────────────────

function createLocalClient() {
  return {
    from: (table: string) => new QueryBuilder(table),
  };
}

export const supabase = createLocalClient();
export const supabaseAdmin = createLocalClient();

// ── Count helper ──────────────────────────────────────────────────────────────
class CountBuilder {
  private _qb: QueryBuilder;
  constructor(qb: QueryBuilder) { this._qb = qb; }
  eq(col: string, val: unknown) { (this._qb as any).eq(col, val); return this; }
  neq(col: string, val: unknown) { (this._qb as any).neq(col, val); return this; }
  gt(col: string, val: unknown) { (this._qb as any).gt(col, val); return this; }
  gte(col: string, val: unknown) { (this._qb as any).gte(col, val); return this; }
  lt(col: string, val: unknown) { (this._qb as any).lt(col, val); return this; }
  lte(col: string, val: unknown) { (this._qb as any).lte(col, val); return this; }
  not(col: string, op: string, val: unknown) { (this._qb as any).not(col, op, val); return this; }
  async then(resolve: (v: { count: number | null; error: null | { message: string } }) => void) {
    const { data, error } = await this._qb;
    if (error) { resolve({ count: null, error }); return; }
    resolve({ count: Array.isArray(data) ? data.length : (data ? 1 : 0), error: null });
  }
}
