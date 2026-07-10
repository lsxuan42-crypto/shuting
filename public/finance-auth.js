const TOKEN_KEY = "financeAuthToken";

function financeToken() {
  return localStorage.getItem(TOKEN_KEY) || "";
}

function setFinanceToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

function clearFinanceToken() {
  localStorage.removeItem(TOKEN_KEY);
}

async function financeFetch(url, options = {}) {
  const headers = {
    ...(options.headers || {}),
    Authorization: `Bearer ${financeToken()}`
  };

  const response = await fetch(url, { ...options, headers, cache: "no-store" });
  if (response.status === 401) {
    clearFinanceToken();
    if (!location.pathname.includes("finance-login")) {
      location.href = "/finance-login";
    }
  }
  return response;
}

async function requireFinanceSession(requiredPage) {
  const token = financeToken();
  if (!token) {
    location.href = "/finance-login";
    return null;
  }

  const response = await financeFetch("/api/finance/session");
  const data = await response.json();
  if (!response.ok) return null;

  if (requiredPage && !data.user.pages.includes(requiredPage)) {
    const fallback = data.user.pages.includes("daily") ? "/finance" : "/monthly-report";
    location.href = fallback;
    return null;
  }

  const userAdminLink = document.querySelector("#userAdminLink");
  if (userAdminLink) userAdminLink.classList.toggle("hidden", !data.user.canManageUsers);
  return data;
}

function setupLogout() {
  const logoutButton = document.querySelector("#logoutButton");
  if (!logoutButton) return;

  logoutButton.addEventListener("click", async () => {
    await financeFetch("/api/finance/logout", { method: "POST" });
    clearFinanceToken();
    location.href = "/finance-login";
  });
}

function setupLoginPage() {
  const loginForm = document.querySelector("#loginForm");
  if (!loginForm) return;

  const loginMessage = document.querySelector("#loginMessage");
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    loginMessage.textContent = "";

    const button = loginForm.querySelector("button[type='submit']");
    button.disabled = true;
    button.textContent = "登入中";

    try {
      const response = await fetch("/api/finance/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: loginForm.username.value,
          password: loginForm.password.value
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "登入失敗");

      setFinanceToken(data.token);
      if (data.user.pages.includes("daily")) {
        location.href = "/finance";
      } else {
        location.href = "/monthly-report";
      }
    } catch (error) {
      loginMessage.textContent = error.message;
    } finally {
      button.disabled = false;
      button.textContent = "登入";
    }
  });
}

setupLoginPage();
setupLogout();
