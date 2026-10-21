import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';

// Original column set, in original order.
const COLUMNS = [
  { key: 'accountName', label: 'ACCOUNT NAME', get: (r) => r.accountName },
  { key: 'accountNo', label: 'ACCOUNT NO.', get: (r) => r.accountNo },
  { key: 'contact', label: 'CONTACT NO.', get: (r) => r.contact },
  { key: 'plan', label: 'PLAN', get: (r) => r.plan },
  { key: 'address', label: 'ADDRESS', get: (r) => r.address },
];

// The PLAN column can show either the plan (Mbps) or the raw bill amount.
const PLAN_MODES = {
  plan: { label: 'PLAN', get: (r) => r.plan },
  bill: { label: 'BILL', get: (r) => r.bill },
};

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const stamp = () => new Date().toISOString().slice(0, 10);

const BASE = import.meta.env.VITE_API_URL ?? '';

async function api(path, options) {
  const res = await fetch(`${BASE}${path}`, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export default function App() {
  const [input, setInput] = useState('');
  const [rows, setRows] = useState([]);
  const [notFound, setNotFound] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState({ loaded: 0, fetchedAt: null });
  const [copied, setCopied] = useState(false);
  const [hidden, setHidden] = useState([]); // keys of deleted columns
  const [planMode, setPlanMode] = useState('plan'); // 'plan' | 'bill'

  const names = useMemo(
    () => input.split('\n').map((n) => n.trim()).filter(Boolean),
    [input]
  );

  // Visible columns, with the PLAN column resolved to its current mode.
  const columns = useMemo(
    () =>
      COLUMNS.filter((c) => !hidden.includes(c.key)).map((c) =>
        c.key === 'plan' ? { ...c, ...PLAN_MODES[planMode] } : c
      ),
    [hidden, planMode]
  );

  useEffect(() => {
    api('/api/status').then(setInfo).catch(() => {});
  }, []);

  async function run(action) {
    setBusy(true);
    setError('');
    try {
      if (action === 'reload') {
        setInfo(await api('/api/sync', { method: 'POST' }));
        return;
      }
      const data = await api('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ names }),
      });
      setInfo({ loaded: data.loaded, fetchedAt: data.fetchedAt });
      const flat = [];
      const missing = [];
      data.results.forEach((r, i) => {
        if (r.status === 'not_found') missing.push(r.query);
        r.matches.forEach((m, j) =>
          flat.push({ ...m, id: `${i}-${j}`, query: r.query, multiple: r.status === 'multiple' })
        );
      });
      setRows(flat);
      setNotFound(missing);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const headers = () => columns.map((c) => c.label);
  const lines = () => rows.map((r) => columns.map((c) => c.get(r)));

  async function copyAll() {
    const text = [headers(), ...lines()].map((l) => l.join('\t')).join('\n');
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function exportCsv() {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [headers(), ...lines()].map((l) => l.map(esc).join(',')).join('\r\n');
    // BOM so Excel reads UTF-8 (ñ etc.) correctly
    download(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }), `customers-${stamp()}.csv`);
  }

  function exportXlsx() {
    const ws = XLSX.utils.aoa_to_sheet([headers(), ...lines()]);
    const widths = { accountName: 32, accountNo: 16, contact: 16, plan: 12, address: 60 };
    ws['!cols'] = columns.map((c) => ({ wch: widths[c.key] }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Customers');
    XLSX.writeFile(wb, `customers-${stamp()}.xlsx`);
  }

  const hideColumn = (key) => setHidden((h) => [...h, key]);
  const resetColumns = () => {
    setHidden([]);
    setPlanMode('plan');
  };
  const columnsChanged = hidden.length > 0 || planMode !== 'plan';
  const noColumns = columns.length === 0;

  const ageText = info.fetchedAt
    ? `${info.loaded.toLocaleString()} accounts loaded at ${new Date(info.fetchedAt).toLocaleTimeString()}`
    : 'Account list not loaded yet. It loads on your first search.';

  return (
    <div className="app">
      <header className="top">
        <h1>Customer Fetcher</h1>
        <div className="sync">
          <span>{ageText}</span>
          <button className="ghost" onClick={() => run('reload')} disabled={busy}>
            Reload from site
          </button>
        </div>
      </header>

      <main className="layout">
        <section className="panel input-panel">
          <label htmlFor="names">Names to look up</label>
          <p className="hint">
            One name per line. Word order and middle names don’t matter:
            “chiera bajao” finds CHIERA JOYCE BAJAO and CHIERA BAJAO JOYCE.
          </p>
          <textarea
            id="names"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={'chiera bajao\njuan dela cruz\nmaria santos'}
            spellCheck={false}
          />
          <div className="row">
            <button className="primary" onClick={() => run('search')} disabled={busy || !names.length}>
              {busy ? 'Fetching…' : `Fetch ${names.length || ''} ${names.length === 1 ? 'name' : 'names'}`.replace('  ', ' ')}
            </button>
            {busy && <span className="hint">The first fetch logs in and reads every page, so it can take a minute.</span>}
          </div>
          {error && <p className="error" role="alert">{error}</p>}
        </section>

        <section className="panel results-panel">
          <div className="results-head">
            <h2>
              Results <span className="count">{rows.length}</span>
            </h2>
            <div className="row">
              {columnsChanged && (
                <button className="ghost" onClick={resetColumns}>Reset columns</button>
              )}
              <button className="ghost" onClick={copyAll} disabled={!rows.length || noColumns}>
                {copied ? 'Copied' : 'Copy for Excel'}
              </button>
              <button className="ghost" onClick={exportCsv} disabled={!rows.length || noColumns}>Export CSV</button>
              <button className="primary" onClick={exportXlsx} disabled={!rows.length || noColumns}>Export Excel</button>
            </div>
          </div>

          {!rows.length && !notFound.length ? (
            <p className="empty">Enter names and fetch to see matching accounts here.</p>
          ) : noColumns ? (
            <p className="empty">All columns are removed. Use “Reset columns” to bring them back.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    {columns.map((c) => (
                      <th key={c.key}>
                        <span className="th-inner">
                          <span>{c.label}</span>
                          {c.key === 'plan' && (
                            <button
                              className="swap"
                              title={`Switch to ${planMode === 'plan' ? 'BILL' : 'PLAN'}`}
                              aria-label={`Show ${planMode === 'plan' ? 'bill' : 'plan'} instead`}
                              onClick={() => setPlanMode((m) => (m === 'plan' ? 'bill' : 'plan'))}
                            >
                              ⇄
                            </button>
                          )}
                          <button
                            className="th-x"
                            title={`Remove ${c.label} column`}
                            aria-label={`Remove ${c.label} column`}
                            onClick={() => hideColumn(c.key)}
                          >
                            ×
                          </button>
                        </span>
                      </th>
                    ))}
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className={r.multiple ? 'multi' : ''}>
                      {columns.map((c, i) => (
                        <td key={c.key}>
                          {c.get(r)}
                          {/* the "several matches" tag lives in the first visible column */}
                          {i === 0 && r.multiple && (
                            <span className="tag" title={`Several accounts matched “${r.query}”`}>
                              1 of several for “{r.query}”
                            </span>
                          )}
                        </td>
                      ))}
                      <td>
                        <button
                          className="x"
                          aria-label={`Remove ${r.accountName}`}
                          onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {notFound.length > 0 && (
            <div className="notfound">
              <h3>No match ({notFound.length})</h3>
              <p>{notFound.join(', ')}</p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}