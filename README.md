# Customer Fetcher

Paste a list of names, fetch the matching accounts from glercimor.com, then copy or export them.
React (Vite) frontend + Node/Playwright scraper. No database.

## Setup
1. `npm install`
2. `npm run setup`  (installs both apps and the Chromium browser used for scraping)
3. Copy `server/.env.example` to `server/.env` and put in your login.
4. `npm run dev`, then open http://localhost:5173

## How it works
- The server logs in at https://glercimor.com/auth, opens /customer/multiservices, and reads the whole table (all pages) once.
  The result is kept in memory for 30 minutes (CACHE_MINUTES), so a big name list is matched instantly instead of searching the site per name.
- Names are matched ignoring word order, case, punctuation, middle names, partial words and 1-2 letter typos.
- Plan comes from the Bill column: 999=55, 1299=105, 1499=155, 1999=205, 2499=305 mbps (edit `billToMbps` in server/config.js).
- Export: CSV, Excel (.xlsx), or "Copy for Excel" (paste straight into a sheet). Excel keeps leading zeros in phone numbers; CSV may drop them when opened in Excel.

## If it doesn't read the site correctly
- Open http://localhost:3001/api/inspect to see the detected headers and 3 sample rows.
- Wrong/missing column: edit the `columns` patterns in server/config.js.
- Login not working: edit `selectors` in server/config.js, or set HEADLESS=false in .env to watch the browser.
