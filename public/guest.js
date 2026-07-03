const form = document.querySelector("#queueForm");
const formMessage = document.querySelector("#formMessage");
const ticket = document.querySelector("#ticket");
const ticketNumber = document.querySelector("#ticketNumber");
const ticketMeta = document.querySelector("#ticketMeta");
const ticketName = document.querySelector("#ticketName");
const ticketParty = document.querySelector("#ticketParty");
const publicQueue = document.querySelector("#publicQueue");
const queueCount = document.querySelector("#queueCount");
const heroQueueCount = document.querySelector("#heroQueueCount");
const waitingPeople = document.querySelector("#waitingPeople");
const nowCalling = document.querySelector("#nowCalling");
const nextNumber = document.querySelector("#nextNumber");
const currentTime = document.querySelector("#currentTime");
const currentDate = document.querySelector("#currentDate");
const decreaseParty = document.querySelector("#decreaseParty");
const increaseParty = document.querySelector("#increaseParty");
const partySizeInput = document.querySelector("#partySize");

const timeFormatter = new Intl.DateTimeFormat("zh-TW", {
  hour: "2-digit",
  minute: "2-digit"
});

const dateFormatter = new Intl.DateTimeFormat("zh-TW", {
  month: "numeric",
  day: "numeric",
  weekday: "short"
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
  if (status === "called") return "請入座";
  return "等待中";
}

function updateClock() {
  const now = new Date();
  currentTime.textContent = timeFormatter.format(now);
  currentDate.textContent = dateFormatter.format(now);
}

function getPartySize() {
  return Number(partySizeInput.value) || 1;
}

function setPartySize(value) {
  partySizeInput.value = Math.min(20, Math.max(1, value));
}

function renderQueue(queue) {
  const calledEntry = queue.find((entry) => entry.status === "called");
  const waitingEntries = queue.filter((entry) => entry.status === "waiting");
  const peopleCount = queue.reduce((total, entry) => total + Number(entry.partySize || 0), 0);
  const nextWaiting = waitingEntries[0];

  queueCount.textContent = `${queue.length} 組 / ${peopleCount} 位`;
  heroQueueCount.textContent = queue.length;
  waitingPeople.textContent = peopleCount;
  nowCalling.textContent = calledEntry ? formatNumber(calledEntry.number) : "--";
  nextNumber.textContent = nextWaiting ? formatNumber(nextWaiting.number) : "--";

  if (!queue.length) {
    publicQueue.innerHTML = `<div class="queue-empty">目前沒有候位</div>`;
    return;
  }

  publicQueue.innerHTML = queue
    .map((entry, index) => {
      const time = timeFormatter.format(new Date(entry.createdAt));
      const beforeEntries = queue.slice(0, index);
      const beforeGroups = beforeEntries.length;
      const beforePeople = beforeEntries.reduce((total, item) => total + Number(item.partySize || 0), 0);
      const rowClass = entry.status === "called" ? "queue-row is-called" : "queue-row";

      return `
        <article class="${rowClass}">
          <div class="number-pill">${formatNumber(entry.number)}</div>
          <div class="row-main">
            <strong>${entry.name || "貴賓"} · ${maskPhone(entry.phone)}</strong>
            <span>${entry.partySize} 位 · ${entry.seatingPreference || "不限"} · ${time}</span>
          </div>
          <div class="queue-position">
            <span>${entry.status === "called" ? "請入座" : `前 ${beforeGroups} 組 / ${beforePeople} 位`}</span>
            <b class="${entry.status === "called" ? "status-called" : ""}">${statusText(entry.status)}</b>
          </div>
        </article>
      `;
    })
    .join("");
}

async function loadQueue() {
  const response = await fetch("/api/queue", { cache: "no-store" });
  const data = await response.json();
  renderQueue(data.queue);
}

decreaseParty.addEventListener("click", () => {
  setPartySize(getPartySize() - 1);
});

increaseParty.addEventListener("click", () => {
  setPartySize(getPartySize() + 1);
});

partySizeInput.addEventListener("change", () => {
  setPartySize(getPartySize());
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  formMessage.textContent = "";

  const button = form.querySelector("button[type='submit']");
  button.disabled = true;
  button.textContent = "處理中";

  try {
    const response = await fetch("/api/queue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name.value,
        partySize: Number(form.partySize.value),
        seatingPreference: form.seatingPreference.value,
        phone: form.phone.value
      })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "取號失敗，請稍後再試。");

    ticket.classList.remove("hidden");
    ticketNumber.textContent = formatNumber(data.entry.number);
    ticketMeta.textContent = `前方候位狀態會即時更新`;
    ticketName.textContent = data.entry.name;
    ticketParty.textContent = `${data.entry.partySize} 位`;
    form.reset();
    setPartySize(2);
    await loadQueue();
  } catch (error) {
    formMessage.textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = "取得候位號碼";
  }
});

updateClock();
loadQueue();
setInterval(updateClock, 1000);
setInterval(loadQueue, 5000);
