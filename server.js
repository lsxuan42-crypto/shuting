const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const ADMIN_PIN = process.env.ADMIN_PIN || "1234";
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = process.env.DATA_FILE || path.join(DATA_DIR, "queue.json");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
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

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
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

function normalizePhone(phone) {
  return String(phone || "").replace(/[^\d+]/g, "").slice(0, 20);
}

function handleStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  if (pathname === "/admin") pathname = "/admin.html";

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
      "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=3600"
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
    sendJson(res, 200, { queue: publicQueue(store.entries), lastNumber: store.lastNumber });
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
      if (nextStatus === "called") entry.calledAt = new Date().toISOString();
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
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Waitlist app is running at http://localhost:${PORT}`);
});
