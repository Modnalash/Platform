// In-memory stand-in for supabase-js, used only for local testing.
// It mimics the parts of the API the portal uses, including the 1000-row cap.
(function () {
  const DB = window.__DB;
  window.__WRITES = [];
  const MAX_ROWS = 1000;
  const clone = x => JSON.parse(JSON.stringify(x));

  class Query {
    constructor(table) {
      this.t = table; this.filters = []; this.op = 'select'; this.opts = {};
      this._order = null; this._range = null; this._limit = null; this._single = false; this.returning = false;
    }
    select(cols, opts) { if (this.op === 'select') { this.opts = opts || {}; } else { this.returning = true; } return this; }
    insert(rows) { this.op = 'insert'; this.rows = Array.isArray(rows) ? rows : [rows]; return this; }
    update(values) { this.op = 'update'; this.values = values; return this; }
    delete() { this.op = 'delete'; return this; }
    eq(c, v) { this.filters.push(r => String(r[c]) === String(v)); return this; }
    gte(c, v) { this.filters.push(r => new Date(String(r[c]).replace('Z', '')) >= new Date(String(v).replace('Z', ''))); return this; }
    order(c, o) { this._order = [c, !(o && o.ascending === false)]; return this; }
    range(a, b) { this._range = [a, b]; return this; }
    limit(n) { this._limit = n; return this; }
    single() { this._single = true; return this; }
    match(r) { return this.filters.every(f => f(r)); }
    exec() {
      const table = DB[this.t];
      if (!table) return { data: null, error: { message: 'relation "' + this.t + '" does not exist' } };
      if (this.op === 'insert') {
        const added = this.rows.map(r => {
          const row = Object.assign({}, r);
          if (row.id === undefined) row.id = table.reduce((m, x) => Math.max(m, +x.id || 0), 0) + 1;
          if (this.t === 'orders' && !row.created_at) row.created_at = new Date().toISOString().replace('Z', '');
          if (this.t === 'audit_log' && !row.timestamp) row.timestamp = new Date().toISOString();
          table.push(row); return row;
        });
        window.__WRITES.push({ op: 'insert', table: this.t, rows: clone(added) });
        return { data: this.returning ? clone(added) : null, error: null };
      }
      if (this.op === 'update') {
        const hit = table.filter(r => this.match(r));
        hit.forEach(r => Object.assign(r, this.values));
        window.__WRITES.push({ op: 'update', table: this.t, values: clone(this.values), matched: hit.length });
        return { data: null, error: null };
      }
      if (this.op === 'delete') {
        const keep = table.filter(r => !this.match(r));
        window.__WRITES.push({ op: 'delete', table: this.t, matched: table.length - keep.length });
        table.length = 0; keep.forEach(r => table.push(r));
        return { data: null, error: null };
      }
      let rows = table.filter(r => this.match(r));
      const count = rows.length;
      if (this._order) {
        const [c, asc] = this._order;
        rows = rows.slice().sort((a, b) => (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * (asc ? 1 : -1));
      }
      if (this._range) rows = rows.slice(this._range[0], this._range[1] + 1);
      if (this._limit != null) rows = rows.slice(0, this._limit);
      rows = rows.slice(0, MAX_ROWS);
      if (this.opts.head) return { data: null, count, error: null };
      if (this._single) {
        if (rows.length !== 1) return { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } };
        return { data: clone(rows[0]), error: null };
      }
      return { data: clone(rows), count: this.opts.count ? count : null, error: null };
    }
    then(res, rej) { return Promise.resolve().then(() => this.exec()).then(res, rej); }
  }

  const auth = {
    getUser: async () => ({ data: { user: window.__USER || null }, error: null }),
    getSession: async () => ({ data: { session: window.__USER ? { user: window.__USER } : null }, error: null }),
    signInWithPassword: async ({ email }) => {
      const p = DB.profiles.find(x => x.email === email);
      if (!p) return { data: null, error: { message: 'Invalid login credentials' } };
      window.__USER = { id: p.id, email: p.email };
      document.cookie = 'tuser=' + p.id + '; path=/';
      return { data: { user: window.__USER }, error: null };
    },
    signUp: async () => ({ data: {}, error: null }),
    signOut: async () => { window.__SIGNED_OUT = true; window.__USER = null; document.cookie = 'tuser=none; path=/'; return { error: null }; },
  };
  const client = { from: t => new Query(t), auth, supabaseKey: 'test' };
  window.supabase = { createClient: () => client };
})();
