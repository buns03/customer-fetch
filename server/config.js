import 'dotenv/config';

export default {
  loginUrl: 'https://glercimor.com/auth',
  dataUrl: 'https://glercimor.com/customer/multiservices',
  username: process.env.GLERCIMOR_USER,
  password: process.env.GLERCIMOR_PASS,
  headless: process.env.HEADLESS !== 'false',
  cacheMinutes: Number(process.env.CACHE_MINUTES || 30),
  maxPages: 1000,

  // CSS selectors. If the site's markup differs, adjust these first.
  selectors: {
    username:
      'input[type="email"], input[name="email"], input[name="username"], input[id*="user" i], input[type="text"]',
    password: 'input[type="password"]',
    submit: 'button[type="submit"], input[type="submit"]',
    table: 'table',
    // "Next page" button (DataTables style by default)
    nextButton:
      '.paginate_button.next:not(.disabled), li.next:not(.disabled) a, a[rel="next"]',
    // "Show N entries" dropdown (DataTables style by default)
    pageLength: 'select[name$="_length"]',
  },

  // Table header text -> field. First header that matches wins.
  // If a column is not found, run GET /api/inspect and tweak these patterns.
  columns: {
    accountName: /account\s*name|customer\s*name|^name$|subscriber/i,
    accountNo: /account\s*(no|num|#)|acct/i,
    contact: /contact|phone|mobile|cell/i,
    bill: /bill/i,
    address: /address/i,
  },

  // Bill amount (PHP) -> plan speed
  billToMbps: {
    999: 55,
    1299: 105,
    1499: 155,
    1999: 205,
    2499: 305,
  },
};
