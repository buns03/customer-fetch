import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';

const HEADERS = ['ACCOUNT NAME', 'ACCOUNT NO.', 'CONTACT NO.', 'PLAN', 'ADDRESS'];
const toLine = (r) => [r.accountName, r.accountNo, r.contact, r.plan, r.address];

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const stamp = () => new Date().toISOString().slice(0, 10);

async function api(path, options) {
  const res = await fetch(path, options);
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

  const names = useMemo(
    () => input.split('\n').map((n) => n.trim()).filter(Boolean),
    [input]
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

  const lines = () => rows.map(toLine);

  async function copyAll() {
    const text = [HEADERS, ...lines()].map((l) => l.join('\t')).join('\n');
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function exportCsv() {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [HEADERS, ...lines()].map((l) => l.map(esc).join(',')).join('\r\n');
    // BOM so Excel reads UTF-8 (ñ etc.) correctly
    download(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }), `customers-${stamp()}.csv`);
  }

  function exportXlsx() {
    const ws = XLSX.utils.aoa_to_sheet([HEADERS, ...lines()]);
    ws['!cols'] = [{ wch: 32 }, { wch: 16 }, { wch: 16 }, { wch: 12 }, { wch: 60 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Customers');
    XLSX.writeFile(wb, `customers-${stamp()}.xlsx`);
  }

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
              <button className="ghost" onClick={copyAll} disabled={!rows.length}>
                {copied ? 'Copied' : 'Copy for Excel'}
              </button>
              <button className="ghost" onClick={exportCsv} disabled={!rows.length}>Export CSV</button>
              <button className="primary" onClick={exportXlsx} disabled={!rows.length}>Export Excel</button>
            </div>
          </div>

          {!rows.length && !notFound.length ? (
            <p className="empty">Enter names and fetch to see matching accounts here.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    {HEADERS.map((h) => <th key={h}>{h}</th>)}
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className={r.multiple ? 'multi' : ''}>
                      <td>
                        {r.accountName}
                        {r.multiple && (
                          <span className="tag" title={`Several accounts matched “${r.query}”`}>
                            1 of several for “{r.query}”
                          </span>
                        )}
                      </td>
                      <td>{r.accountNo}</td>
                      <td>{r.contact}</td>
                      <td>{r.plan}</td>
                      <td>{r.address}</td>
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
