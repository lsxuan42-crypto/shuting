const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const ADMIN_PIN = process.env.ADMIN_PIN || "1234";
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = process.env.DATA_FILE || path.join(DATA_DIR, "queue.json");
const FINANCE_FILE = process.env.FINANCE_FILE || path.join(DATA_DIR, "finance-reports.json");
const FINANCE_USERS_FILE = process.env.FINANCE_USERS_FILE || path.join(DATA_DIR, "finance-users.json");
const FINANCE_RECEIPTS_DIR = process.env.FINANCE_RECEIPTS_DIR || path.join(DATA_DIR, "finance-receipts");

const STORES = [
  { id: "minxiong", name: "民雄" },
  { id: "wanjiafu", name: "萬家福" },
  { id: "puzi", name: "朴子" }
];

const DEFAULT_FEE_RATES = {
  linePay: 0.025,
  card: 0.02,
  foodpanda: 0.32
};

const DEFAULT_FINANCE_STORE = {
  reports: [],
  feeRates: {
    minxiong: { ...DEFAULT_FEE_RATES },
    wanjiafu: { ...DEFAULT_FEE_RATES },
    puzi: { ...DEFAULT_FEE_RATES }
  }
};

const financeSessions = new Map();

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
};

function ensureDataFile() {
  const directory = path.dirname(DATA_FILE);
  if (!fs.existsSync(directory)) fs.mkdirSync(directory, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ lastNumber: 0, entries: [] }, null, 2));
  }
}

function readStore() {
  ensureDataFile();
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}

function writeStore(store) {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
}

function ensureFinanceFile() {
  const directory = path.dirname(FINANCE_FILE);
  if (!fs.existsSync(directory)) fs.mkdirSync(directory, { recursive: true });
  if (!fs.existsSync(FINANCE_RECEIPTS_DIR)) fs.mkdirSync(FINANCE_RECEIPTS_DIR, { recursive: true });
  if (!fs.existsSync(FINANCE_FILE)) {
    fs.writeFileSync(FINANCE_FILE, JSON.stringify(DEFAULT_FINANCE_STORE, null, 2));
  }
}

function readFinanceStore() {
  ensureFinanceFile();
  const store = JSON.parse(fs.readFileSync(FINANCE_FILE, "utf8"));
  const flatFeeRates = store.feeRates || {};
  const feeRates = {};
  for (const storeInfo of STORES) {
    feeRates[storeInfo.id] = {
      ...DEFAULT_FEE_RATES,
      ...(flatFeeRates[storeInfo.id] || {})
    };
  }

  if (typeof flatFeeRates.linePay === "number") {
    for (const storeInfo of STORES) {
      feeRates[storeInfo.id] = {
        ...feeRates[storeInfo.id],
        linePay: flatFeeRates.linePay,
        card: flatFeeRates.card,
        foodpanda: flatFeeRates.foodpanda
      };
    }
  }

  return {
    reports: Array.isArray(store.reports)
      ? store.reports.map((report) => ({ storeId: "minxiong", ...report }))
      : [],
    feeRates
  };
}

function writeFinanceStore(store) {
  ensureFinanceFile();
  fs.writeFileSync(FINANCE_FILE, JSON.stringify(store, null, 2));
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(String(password), salt, 120000, 32, "sha256").toString("hex");
  return { salt, hash };
}

function verifyPassword(password, user) {
  if (!user?.salt || !user?.passwordHash) return false;
  const result = hashPassword(password, user.salt);
  return crypto.timingSafeEqual(Buffer.from(result.hash, "hex"), Buffer.from(user.passwordHash, "hex"));
}

function defaultFinanceUsers() {
  const password = hashPassword(process.env.FINANCE_ADMIN_PASSWORD || "1234");
  return {
    users: [
      {
        username: "admin",
        displayName: "管理者",
        passwordHash: password.hash,
        salt: password.salt,
        stores: STORES.map((store) => store.id),
        pages: ["daily", "monthly"],
        canManageUsers: true,
        active: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ]
  };
}

function ensureFinanceUsersFile() {
  const directory = path.dirname(FINANCE_USERS_FILE);
  if (!fs.existsSync(directory)) fs.mkdirSync(directory, { recursive: true });
  if (!fs.existsSync(FINANCE_USERS_FILE)) {
    fs.writeFileSync(FINANCE_USERS_FILE, JSON.stringify(defaultFinanceUsers(), null, 2));
  }
}

function readFinanceUsers() {
  ensureFinanceUsersFile();
  const store = JSON.parse(fs.readFileSync(FINANCE_USERS_FILE, "utf8"));
  return { users: Array.isArray(store.users) ? store.users : [] };
}

function writeFinanceUsers(store) {
  ensureFinanceUsersFile();
  fs.writeFileSync(FINANCE_USERS_FILE, JSON.stringify(store, null, 2));
}

function publicUser(user) {
  return {
    username: user.username,
    displayName: user.displayName,
    stores: Array.isArray(user.stores) ? user.stores : [],
    pages: Array.isArray(user.pages) ? user.pages : [],
    canManageUsers: Boolean(user.canManageUsers),
    active: user.active !== false
  };
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(data));
}

function sendAuthError(res) {
  sendJson(res, 401, { error: "請先登入。" });
}

function storeExists(storeId) {
  return STORES.some((store) => store.id === storeId);
}

function authToken(req) {
  const header = String(req.headers.authorization || "");
  if (header.startsWith("Bearer ")) return header.slice(7).trim();
  return String(req.headers["x-finance-token"] || "").trim();
}

function currentFinanceUser(req) {
  const token = authToken(req);
  if (!token) return null;
  const session = financeSessions.get(token);
  if (!session) return null;

  const usersStore = readFinanceUsers();
  const user = usersStore.users.find((item) => item.username === session.username && item.active !== false);
  return user || null;
}

function hasStoreAccess(user, storeId) {
  return Array.isArray(user?.stores) && user.stores.includes(storeId);
}

function hasPageAccess(user, page) {
  return Array.isArray(user?.pages) && user.pages.includes(page);
}

function requireFinanceUser(req, res, options = {}) {
  const user = currentFinanceUser(req);
  if (!user) {
    sendAuthError(res);
    return null;
  }

  if (options.page && !hasPageAccess(user, options.page)) {
    sendJson(res, 403, { error: "此帳號沒有這個報表權限。" });
    return null;
  }

  if (options.storeId && !hasStoreAccess(user, options.storeId)) {
    sendJson(res, 403, { error: "此帳號沒有這個店面的權限。" });
    return null;
  }

  if (options.manageUsers && !user.canManageUsers) {
    sendJson(res, 403, { error: "此帳號沒有管理權限。" });
    return null;
  }

  return user;
}

function allowedStores(user) {
  const allowed = new Set(Array.isArray(user?.stores) ? user.stores : []);
  return STORES.filter((store) => allowed.has(store.id));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 20_000_000) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}

function isAdmin(req) {
  return req.headers["x-admin-pin"] === ADMIN_PIN;
}

function publicQueue(entries) {
  return entries
    .filter((entry) => entry.status === "waiting" || entry.status === "called")
    .map(({ id, number, name, partySize, seatingPreference, phone, status, createdAt, calledAt }) => ({
      id,
      number,
      name,
      partySize,
      seatingPreference,
      phone,
      status,
      createdAt,
      calledAt
    }));
}

function publicSummary(entries) {
  const activeEntries = publicQueue(entries);
  const waitingEntries = activeEntries.filter((entry) => entry.status === "waiting");
  const lastCalledEntry = entries
    .filter((entry) => entry.calledAt)
    .sort((a, b) => new Date(b.calledAt) - new Date(a.calledAt))[0];
  const waitingPeople = activeEntries.reduce((total, entry) => total + Number(entry.partySize || 0), 0);

  return {
    lastCalledNumber: lastCalledEntry ? lastCalledEntry.number : null,
    lastCalledAt: lastCalledEntry ? lastCalledEntry.calledAt : null,
    waitingGroups: activeEntries.length,
    waitingPeople,
    nextNumber: waitingEntries[0] ? waitingEntries[0].number : null
  };
}

function normalizePhone(phone) {
  return String(phone || "").replace(/[^\d+]/g, "").slice(0, 20);
}

function parseAmount(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.round(number);
}

function parseRate(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) return fallback;
  return number;
}

function normalizeReport(body, storeId) {
  const date = String(body.date || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("請選擇正確日期。");
  }

  const income = body.income || {};
  const expenses = body.expenses || {};
  const normalized = {
    storeId,
    date,
    income: {
      linePay: parseAmount(income.linePay),
      cash: parseAmount(income.cash),
      card: parseAmount(income.card),
      voucher: parseAmount(income.voucher),
      foodpanda: parseAmount(income.foodpanda)
    },
    expenses: {
      seafood: parseAmount(expenses.seafood),
      meat: parseAmount(expenses.meat),
      supplies: parseAmount(expenses.supplies),
      vegetables: parseAmount(expenses.vegetables),
      otherFood: parseAmount(expenses.otherFood),
      ingredients: parseAmount(expenses.ingredients)
    },
    note: String(body.note || "").trim().slice(0, 300),
    updatedAt: new Date().toISOString()
  };

  normalized.totalIncome = Object.values(normalized.income).reduce((sum, value) => sum + value, 0);
  normalized.totalExpenses = Object.values(normalized.expenses).reduce((sum, value) => sum + value, 0);
  normalized.dailyProfit = normalized.totalIncome - normalized.totalExpenses;
  return normalized;
}

function safeFileName(name) {
  const parsed = path.parse(String(name || "receipt"));
  const base = parsed.name.replace(/[^\w\u4e00-\u9fa5-]+/g, "-").slice(0, 48) || "receipt";
  return base;
}

function extensionForReceipt(type, name) {
  const ext = path.extname(String(name || "")).toLowerCase();
  const byType = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "application/pdf": ".pdf"
  };
  if (Object.values(byType).includes(ext)) return ext;
  return byType[type] || "";
}

function parseReceiptDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) return null;
  return {
    type: match[1],
    buffer: Buffer.from(match[2], "base64")
  };
}

function publicReceipt(receipt) {
  return {
    id: receipt.id,
    name: receipt.name,
    type: receipt.type,
    size: receipt.size,
    uploadedAt: receipt.uploadedAt,
    uploadedBy: receipt.uploadedBy
  };
}

function findReceipt(financeStore, receiptId) {
  for (const report of financeStore.reports) {
    const receipt = (report.receipts || []).find((item) => item.id === receiptId);
    if (receipt) return { report, receipt };
  }
  return null;
}

function monthRange(month) {
  const value = String(month || "").trim();
  if (!/^\d{4}-\d{2}$/.test(value)) {
    throw new Error("月份格式不正確。");
  }
  return {
    month: value,
    start: `${value}-01`,
    endPrefix: value
  };
}

function getMonthReports(store, month) {
  const range = monthRange(month);
  return store.reports
    .filter((report) => String(report.date || "").startsWith(range.endPrefix))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function getStoreMonthReports(store, month, storeId) {
  return getMonthReports(store, month).filter((report) => report.storeId === storeId);
}

function buildMonthlySummary(reports, feeRates) {
  const summary = {
    income: { linePay: 0, cash: 0, card: 0, voucher: 0, foodpanda: 0 },
    expenses: { seafood: 0, meat: 0, supplies: 0, vegetables: 0, otherFood: 0, ingredients: 0 },
    fees: { linePay: 0, card: 0, foodpanda: 0 },
    totalIncome: 0,
    totalExpenses: 0,
    totalFees: 0,
    monthlyProfit: 0,
    reportCount: reports.length
  };

  for (const report of reports) {
    for (const key of Object.keys(summary.income)) {
      summary.income[key] += Number(report.income?.[key] || 0);
    }
    for (const key of Object.keys(summary.expenses)) {
      summary.expenses[key] += Number(report.expenses?.[key] || 0);
    }
  }

  summary.totalIncome = Object.values(summary.income).reduce((sum, value) => sum + value, 0);
  summary.totalExpenses = Object.values(summary.expenses).reduce((sum, value) => sum + value, 0);
  summary.fees.linePay = Math.round(summary.income.linePay * feeRates.linePay);
  summary.fees.card = Math.round(summary.income.card * feeRates.card);
  summary.fees.foodpanda = Math.round(summary.income.foodpanda * feeRates.foodpanda);
  summary.totalFees = Object.values(summary.fees).reduce((sum, value) => sum + value, 0);
  summary.monthlyProfit = summary.totalIncome - summary.totalExpenses - summary.totalFees;
  return summary;
}

function handleStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  if (pathname === "/admin") pathname = "/admin.html";
  if (pathname === "/finance") pathname = "/finance.html";
  if (pathname === "/monthly-report") pathname = "/monthly-report.html";
  if (pathname === "/finance-login") pathname = "/finance-login.html";
  if (pathname === "/finance-users") pathname = "/finance-users.html";

  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(content);
  });
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/queue") {
    const store = readStore();
    sendJson(res, 200, {
      queue: publicQueue(store.entries),
      summary: publicSummary(store.entries),
      lastNumber: store.lastNumber
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/queue") {
    try {
      const body = await readBody(req);
      const name = String(body.name || "").trim().slice(0, 20);
      const partySize = Number(body.partySize);
      const seatingPreference = String(body.seatingPreference || "不限").trim().slice(0, 20);
      const phone = normalizePhone(body.phone);

      if (!name) {
        sendJson(res, 400, { error: "請填寫姓名。" });
        return;
      }

      if (!Number.isInteger(partySize) || partySize < 1 || partySize > 20) {
        sendJson(res, 400, { error: "人數請填 1 到 20 人。" });
        return;
      }

      if (!/^(\+?\d{8,20})$/.test(phone)) {
        sendJson(res, 400, { error: "電話格式不正確，請輸入 8 到 20 位數字。" });
        return;
      }

      const store = readStore();
      store.lastNumber += 1;

      const entry = {
        id: crypto.randomUUID(),
        number: store.lastNumber,
        name,
        partySize,
        seatingPreference,
        phone,
        status: "waiting",
        createdAt: new Date().toISOString(),
        calledAt: null,
        seatedAt: null,
        canceledAt: null
      };

      store.entries.push(entry);
      writeStore(store);
      sendJson(res, 201, { entry });
    } catch (error) {
      sendJson(res, 400, { error: "資料格式不正確。" });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/admin/queue") {
    if (!isAdmin(req)) {
      sendJson(res, 401, { error: "管理 PIN 不正確。" });
      return;
    }

    const store = readStore();
    sendJson(res, 200, { queue: store.entries, lastNumber: store.lastNumber });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/finance/login") {
    try {
      const body = await readBody(req);
      const username = String(body.username || "").trim();
      const password = String(body.password || "");
      const usersStore = readFinanceUsers();
      const user = usersStore.users.find((item) => item.username === username && item.active !== false);

      if (!user || !verifyPassword(password, user)) {
        sendJson(res, 401, { error: "帳號或密碼不正確。" });
        return;
      }

      const token = crypto.randomUUID();
      financeSessions.set(token, { username: user.username, createdAt: Date.now() });
      sendJson(res, 200, { token, user: publicUser(user), stores: allowedStores(user) });
    } catch (error) {
      sendJson(res, 400, { error: "資料格式不正確。" });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/finance/logout") {
    const token = authToken(req);
    if (token) financeSessions.delete(token);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/finance/session") {
    const user = requireFinanceUser(req, res);
    if (!user) return;

    sendJson(res, 200, {
      user: publicUser(user),
      stores: allowedStores(user)
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/finance/users") {
    const user = requireFinanceUser(req, res, { manageUsers: true });
    if (!user) return;

    const usersStore = readFinanceUsers();
    sendJson(res, 200, {
      stores: STORES,
      users: usersStore.users.map(publicUser)
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/finance/users") {
    const currentUser = requireFinanceUser(req, res, { manageUsers: true });
    if (!currentUser) return;

    try {
      const body = await readBody(req);
      const username = String(body.username || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 32);
      const displayName = String(body.displayName || username).trim().slice(0, 40);
      const stores = Array.isArray(body.stores) ? body.stores.filter(storeExists) : [];
      const pages = Array.isArray(body.pages)
        ? body.pages.filter((page) => page === "daily" || page === "monthly")
        : [];
      const password = String(body.password || "");

      if (!username) {
        sendJson(res, 400, { error: "請輸入帳號。" });
        return;
      }
      if (!stores.length) {
        sendJson(res, 400, { error: "至少要選一個店面。" });
        return;
      }
      if (!pages.length) {
        sendJson(res, 400, { error: "至少要選一個報表權限。" });
        return;
      }

      const usersStore = readFinanceUsers();
      const existing = usersStore.users.find((item) => item.username === username);
      const now = new Date().toISOString();
      let passwordFields = {};

      if (!existing || password) {
        if (password.length < 4) {
          sendJson(res, 400, { error: "密碼至少 4 碼。" });
          return;
        }
        const hashed = hashPassword(password);
        passwordFields = { passwordHash: hashed.hash, salt: hashed.salt };
      }

      const nextUser = {
        ...(existing || { createdAt: now }),
        username,
        displayName,
        stores,
        pages,
        canManageUsers: Boolean(body.canManageUsers),
        active: body.active !== false,
        updatedAt: now,
        ...passwordFields
      };

      if (existing) {
        usersStore.users = usersStore.users.map((item) => (item.username === username ? nextUser : item));
      } else {
        usersStore.users.push(nextUser);
      }

      writeFinanceUsers(usersStore);
      sendJson(res, 200, { user: publicUser(nextUser) });
    } catch (error) {
      sendJson(res, 400, { error: "資料格式不正確。" });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/finance/reports") {
    const storeId = String(url.searchParams.get("store") || "").trim();
    const user = requireFinanceUser(req, res, { page: "monthly", storeId });
    if (!user) return;

    if (!storeExists(storeId)) {
      sendJson(res, 400, { error: "店面不正確。" });
      return;
    }

    const financeStore = readFinanceStore();
    const month = url.searchParams.get("month") || new Date().toISOString().slice(0, 7);

    try {
      const reports = getStoreMonthReports(financeStore, month, storeId);
      const feeRates = financeStore.feeRates[storeId] || DEFAULT_FEE_RATES;
      sendJson(res, 200, {
        store: STORES.find((item) => item.id === storeId),
        reports: reports.map((report) => ({
          ...report,
          receipts: (report.receipts || []).map(publicReceipt)
        })),
        feeRates,
        summary: buildMonthlySummary(reports, feeRates)
      });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/finance/report") {
    const storeId = String(url.searchParams.get("store") || "").trim();
    const user = requireFinanceUser(req, res, { page: "daily", storeId });
    if (!user) return;

    if (!storeExists(storeId)) {
      sendJson(res, 400, { error: "店面不正確。" });
      return;
    }

    const financeStore = readFinanceStore();
    const date = String(url.searchParams.get("date") || "").trim();
    const report = financeStore.reports.find((item) => item.storeId === storeId && item.date === date) || null;
    sendJson(res, 200, {
      report: report ? { ...report, receipts: (report.receipts || []).map(publicReceipt) } : null,
      feeRates: financeStore.feeRates[storeId] || DEFAULT_FEE_RATES
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/finance/report") {
    try {
      const body = await readBody(req);
      const storeId = String(body.storeId || "").trim();
      const user = requireFinanceUser(req, res, { page: "daily", storeId });
      if (!user) return;

      if (!storeExists(storeId)) {
        sendJson(res, 400, { error: "店面不正確。" });
        return;
      }

      const report = normalizeReport(body, storeId);
      const financeStore = readFinanceStore();
      const existingIndex = financeStore.reports.findIndex(
        (item) => item.storeId === report.storeId && item.date === report.date
      );

      if (existingIndex >= 0) {
        financeStore.reports[existingIndex] = {
          ...financeStore.reports[existingIndex],
          ...report,
          receipts: financeStore.reports[existingIndex].receipts || [],
          createdAt: financeStore.reports[existingIndex].createdAt || report.updatedAt
        };
      } else {
        financeStore.reports.push({
          ...report,
          id: crypto.randomUUID(),
          createdAt: report.updatedAt
        });
      }

      financeStore.reports.sort((a, b) => `${a.storeId}:${a.date}`.localeCompare(`${b.storeId}:${b.date}`));
      writeFinanceStore(financeStore);
      sendJson(res, 200, { report });
    } catch (error) {
      sendJson(res, 400, { error: error.message || "資料格式不正確。" });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/finance/receipts") {
    try {
      const body = await readBody(req);
      const storeId = String(body.storeId || "").trim();
      const date = String(body.date || "").trim();
      const user = requireFinanceUser(req, res, { page: "daily", storeId });
      if (!user) return;

      if (!storeExists(storeId) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        sendJson(res, 400, { error: "店面或日期不正確。" });
        return;
      }

      const files = Array.isArray(body.files) ? body.files : [];
      if (!files.length) {
        sendJson(res, 400, { error: "請選擇要上傳的單據。" });
        return;
      }
      if (files.length > 8) {
        sendJson(res, 400, { error: "一次最多上傳 8 個檔案。" });
        return;
      }

      const preparedFiles = [];
      for (const file of files) {
        const parsed = parseReceiptDataUrl(file.dataUrl);
        const ext = extensionForReceipt(parsed?.type, file.name);
        if (!parsed || !ext) {
          sendJson(res, 400, { error: "只支援 JPG、PNG、WEBP 或 PDF 單據。" });
          return;
        }
        if (parsed.buffer.length > 6_000_000) {
          sendJson(res, 400, { error: "單一檔案不可超過 6MB。" });
          return;
        }
        preparedFiles.push({ file, parsed, ext });
      }

      const financeStore = readFinanceStore();
      let report = financeStore.reports.find((item) => item.storeId === storeId && item.date === date);
      if (!report) {
        report = normalizeReport({ date, income: {}, expenses: {}, note: "" }, storeId);
        report.id = crypto.randomUUID();
        report.createdAt = report.updatedAt;
        report.receipts = [];
        financeStore.reports.push(report);
      }

      const receiptDir = path.join(FINANCE_RECEIPTS_DIR, storeId, date);
      fs.mkdirSync(receiptDir, { recursive: true });
      const uploaded = [];

      for (const { file, parsed, ext } of preparedFiles) {
        const id = crypto.randomUUID();
        const filename = `${id}-${safeFileName(file.name)}${ext}`;
        const relativePath = path.join(storeId, date, filename);
        const fullPath = path.join(FINANCE_RECEIPTS_DIR, relativePath);
        fs.writeFileSync(fullPath, parsed.buffer);

        const receipt = {
          id,
          name: String(file.name || filename).slice(0, 120),
          type: parsed.type,
          size: parsed.buffer.length,
          path: relativePath,
          uploadedAt: new Date().toISOString(),
          uploadedBy: user.username
        };
        report.receipts = [...(report.receipts || []), receipt];
        uploaded.push(publicReceipt(receipt));
      }

      report.updatedAt = new Date().toISOString();
      financeStore.reports.sort((a, b) => `${a.storeId}:${a.date}`.localeCompare(`${b.storeId}:${b.date}`));
      writeFinanceStore(financeStore);
      sendJson(res, 200, { receipts: uploaded });
    } catch (error) {
      sendJson(res, 400, { error: error.message || "單據上傳失敗。" });
    }
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/finance/receipts/")) {
    const user = requireFinanceUser(req, res);
    if (!user) return;

    const receiptId = decodeURIComponent(url.pathname.split("/").pop() || "");
    const financeStore = readFinanceStore();
    const result = findReceipt(financeStore, receiptId);
    if (!result) {
      sendJson(res, 404, { error: "找不到單據。" });
      return;
    }
    if (!hasStoreAccess(user, result.report.storeId) || !hasPageAccess(user, "daily")) {
      sendJson(res, 403, { error: "此帳號沒有這張單據的權限。" });
      return;
    }

    const receiptRoot = path.normalize(FINANCE_RECEIPTS_DIR + path.sep);
    const fullPath = path.normalize(path.join(FINANCE_RECEIPTS_DIR, result.receipt.path));
    if (!fullPath.startsWith(receiptRoot) || !fs.existsSync(fullPath)) {
      sendJson(res, 404, { error: "單據檔案不存在。" });
      return;
    }

    res.writeHead(200, {
      "Content-Type": result.receipt.type || "application/octet-stream",
      "Content-Disposition": `inline; filename="${encodeURIComponent(result.receipt.name)}"`,
      "Cache-Control": "no-store"
    });
    fs.createReadStream(fullPath).pipe(res);
    return;
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/finance/receipts/")) {
    const user = requireFinanceUser(req, res);
    if (!user) return;

    const receiptId = decodeURIComponent(url.pathname.split("/").pop() || "");
    const financeStore = readFinanceStore();
    const result = findReceipt(financeStore, receiptId);
    if (!result) {
      sendJson(res, 404, { error: "找不到單據。" });
      return;
    }
    if (!hasStoreAccess(user, result.report.storeId) || !hasPageAccess(user, "daily")) {
      sendJson(res, 403, { error: "此帳號沒有刪除這張單據的權限。" });
      return;
    }

    const receiptRoot = path.normalize(FINANCE_RECEIPTS_DIR + path.sep);
    const fullPath = path.normalize(path.join(FINANCE_RECEIPTS_DIR, result.receipt.path));
    result.report.receipts = (result.report.receipts || []).filter((item) => item.id !== receiptId);
    result.report.updatedAt = new Date().toISOString();
    writeFinanceStore(financeStore);
    if (fullPath.startsWith(receiptRoot) && fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "PATCH" && url.pathname === "/api/finance/fee-rates") {
    try {
      const body = await readBody(req);
      const storeId = String(body.storeId || "").trim();
      const user = requireFinanceUser(req, res, { page: "monthly", storeId });
      if (!user) return;

      if (!storeExists(storeId)) {
        sendJson(res, 400, { error: "店面不正確。" });
        return;
      }

      const financeStore = readFinanceStore();
      const currentRates = financeStore.feeRates[storeId] || DEFAULT_FEE_RATES;
      financeStore.feeRates[storeId] = {
        linePay: parseRate(body.linePay, currentRates.linePay),
        card: parseRate(body.card, currentRates.card),
        foodpanda: parseRate(body.foodpanda, currentRates.foodpanda)
      };
      writeFinanceStore(financeStore);
      sendJson(res, 200, { feeRates: financeStore.feeRates[storeId] });
    } catch (error) {
      sendJson(res, 400, { error: "資料格式不正確。" });
    }
    return;
  }

  if (req.method === "PATCH" && url.pathname.startsWith("/api/admin/queue/")) {
    if (!isAdmin(req)) {
      sendJson(res, 401, { error: "管理 PIN 不正確。" });
      return;
    }

    try {
      const body = await readBody(req);
      const id = url.pathname.split("/").pop();
      const nextStatus = body.status;
      const allowedStatuses = new Set(["waiting", "called", "seated", "canceled"]);

      if (!allowedStatuses.has(nextStatus)) {
        sendJson(res, 400, { error: "狀態不正確。" });
        return;
      }

      const store = readStore();
      const entry = store.entries.find((item) => item.id === id);
      if (!entry) {
        sendJson(res, 404, { error: "找不到這筆候位。" });
        return;
      }

      entry.status = nextStatus;
      if (nextStatus === "called" || nextStatus === "seated") {
        entry.calledAt = entry.calledAt || new Date().toISOString();
      }
      if (nextStatus === "seated") entry.seatedAt = new Date().toISOString();
      if (nextStatus === "canceled") entry.canceledAt = new Date().toISOString();
      writeStore(store);
      sendJson(res, 200, { entry });
    } catch (error) {
      sendJson(res, 400, { error: "資料格式不正確。" });
    }
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/")) {
    handleApi(req, res);
  } else {
    handleStatic(req, res);
  }
});

ensureDataFile();
ensureFinanceFile();
ensureFinanceUsersFile();
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Waitlist app is running at http://localhost:${PORT}`);
});
