const userForm = document.querySelector("#userForm");
const storeChecks = document.querySelector("#storeChecks");
const userRows = document.querySelector("#userRows");
const userCount = document.querySelector("#userCount");
const userMessage = document.querySelector("#userMessage");

let availableStores = [];
let users = [];

function labelList(values, labels) {
  return values.map((value) => labels[value] || value).join("、");
}

function selectedCheckboxValues(name) {
  return Array.from(userForm.querySelectorAll(`input[name="${name}"]:checked`)).map((input) => input.value);
}

function renderStoreChecks() {
  storeChecks.innerHTML = availableStores
    .map((store) => `<label><input type="checkbox" name="stores" value="${store.id}"> ${store.name}</label>`)
    .join("");
}

function renderUsers() {
  const storeLabels = Object.fromEntries(availableStores.map((store) => [store.id, store.name]));
  const pageLabels = { daily: "日報表", monthly: "月報表" };

  userCount.textContent = `${users.length} 位`;
  if (!users.length) {
    userRows.innerHTML = `<tr><td colspan="6">尚無人員</td></tr>`;
    return;
  }

  userRows.innerHTML = users
    .map((user) => `
      <tr data-username="${user.username}">
        <td>${user.username}</td>
        <td>${user.displayName}</td>
        <td>${labelList(user.stores, storeLabels)}</td>
        <td>${labelList(user.pages, pageLabels)}</td>
        <td>${user.canManageUsers ? "可管理" : ""}</td>
        <td>${user.active ? "啟用" : "停用"}</td>
      </tr>
    `)
    .join("");
}

function fillForm(user) {
  userForm.username.value = user.username;
  userForm.displayName.value = user.displayName;
  userForm.password.value = "";
  userForm.canManageUsers.checked = user.canManageUsers;
  userForm.active.checked = user.active;

  for (const input of userForm.querySelectorAll('input[name="stores"]')) {
    input.checked = user.stores.includes(input.value);
  }
  for (const input of userForm.querySelectorAll('input[name="pages"]')) {
    input.checked = user.pages.includes(input.value);
  }
}

async function loadUsers() {
  const session = await requireFinanceSession();
  if (!session?.user.canManageUsers) {
    location.href = "/finance";
    return;
  }

  const response = await financeFetch("/api/finance/users");
  const data = await response.json();
  if (!response.ok) {
    userMessage.textContent = data.error || "讀取失敗";
    return;
  }

  availableStores = data.stores;
  users = data.users;
  renderStoreChecks();
  renderUsers();
}

userRows.addEventListener("click", (event) => {
  const row = event.target.closest("tr[data-username]");
  if (!row) return;

  const user = users.find((item) => item.username === row.dataset.username);
  if (user) fillForm(user);
});

userForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  userMessage.textContent = "";

  const button = userForm.querySelector("button[type='submit']");
  button.disabled = true;
  button.textContent = "儲存中";

  try {
    const response = await financeFetch("/api/finance/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: userForm.username.value,
        displayName: userForm.displayName.value,
        password: userForm.password.value,
        stores: selectedCheckboxValues("stores"),
        pages: selectedCheckboxValues("pages"),
        canManageUsers: userForm.canManageUsers.checked,
        active: userForm.active.checked
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "儲存失敗");

    userMessage.textContent = "已儲存";
    userForm.password.value = "";
    await loadUsers();
  } catch (error) {
    userMessage.textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = "儲存帳號";
  }
});

loadUsers();
