const pinForm = document.querySelector("#pinForm");
const pinInput = document.querySelector("#pinInput");
const adminStatus = document.querySelector("#adminStatus");
const adminList = document.querySelector("#adminList");
const waitingCount = document.querySelector("#waitingCount");
const calledCount = document.querySelector("#calledCount");
const totalCount = document.querySelector("#totalCount");

let adminPin = localStorage.getItem("waitlistAdminPin") || "";
pinInput.value = adminPin;

const formatter = new Intl.DateTimeFormat("zh-TW", {
  hour: "2-digit",
  minute: "2-digit"
});

function formatNumber(number) {
  return `A${String(number).padStart(3, "0")}`;
}

function maskPhone(phone) {
  const cleanPhone = String(phone || "");
  if (cleanPhone.length < 7) return cleanPhone;
  return `${cleanPhone.slice(0, 4)}***${cleanPhone.slice(-3)}`;
}

function statusText(status) {
  const labels = {
    waiting: "等待中",
    called: "已叫號",
    seated: "已入座",
    canceled: "已取消"
  };
  return labels[status] || status;
}

function statusClass(status) {
  return `status-${status}`;
}

function renderAdmin(queue) {
  const activeQueue = queue.filter((entry) => entry.status === "waiting" || entry.status === "called");
  const waiting = queue.filter((entry) => entry.status === "waiting").length;
  const called = queue.filter((entry) => entry.status === "called").length;

  waitingCount.textContent = waiting;
  calledCount.textContent = called;
  totalCount.textContent = queue.length;

  if (!activeQueue.length) {
    adminList.innerHTML = `<div class="queue-empty">目前沒有等待中的候位</div>`;
    return;
  }

  adminList.innerHTML = activeQueue
    .map((entry) => {
      const time = formatter.format(new Date(entry.createdAt));
      return `
        <article class="admin-row">
          <div class="number-pill">${formatNumber(entry.number)}</div>
          <div class="row-main">
            <strong>${entry.name || "貴賓"}｜${maskPhone(entry.phone)}</strong>
            <span>${entry.partySize} 位｜${entry.seatingPreference || "不限"}｜${time} 取號</span>
            <div class="row-status ${statusClass(entry.status)}">${statusText(entry.status)}</div>
          </div>
          <div class="actions">
            <button data-id="${entry.id}" data-status="called" class="warning">叫號</button>
            <button data-id="${entry.id}" data-status="seated">入座</button>
            <button data-id="${entry.id}" data-status="canceled" class="danger">取消</button>
          </div>
        </article>
      `;
    })
    .join("");
}

async function loadAdminQueue() {
  if (!adminPin) return;

  const response = await fetch("/api/admin/queue", {
    cache: "no-store",
    headers: { "X-Admin-Pin": adminPin }
  });
  const data = await response.json();

  if (!response.ok) {
    adminStatus.textContent = data.error || "登入失敗";
    return;
  }

  adminStatus.textContent = "已登入";
  renderAdmin(data.queue);
}

async function updateStatus(id, status) {
  const response = await fetch(`/api/admin/queue/${id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Pin": adminPin
    },
    body: JSON.stringify({ status })
  });

  const data = await response.json();
  if (!response.ok) {
    adminStatus.textContent = data.error || "更新失敗";
    return;
  }

  await loadAdminQueue();
}

pinForm.addEventListener("submit", (event) => {
  event.preventDefault();
  adminPin = pinInput.value.trim();
  localStorage.setItem("waitlistAdminPin", adminPin);
  loadAdminQueue();
});

adminList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-id]");
  if (!button) return;
  updateStatus(button.dataset.id, button.dataset.status);
});

if (adminPin) loadAdminQueue();
setInterval(loadAdminQueue, 4000);
