const incomeFields = ["linePay", "cash", "card", "voucher", "foodpanda"];
const expenseFields = ["seafood", "meat", "supplies", "vegetables", "otherFood", "ingredients"];

const moneyFormatter = new Intl.NumberFormat("zh-TW", {
  style: "currency",
  currency: "TWD",
  maximumFractionDigits: 0
});

function todayString() {
  const now = new Date();
  const timezoneOffset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - timezoneOffset).toISOString().slice(0, 10);
}

function currentMonthString() {
  return todayString().slice(0, 7);
}

function money(value) {
  return moneyFormatter.format(Number(value || 0));
}

function setMoneyText(element, value) {
  if (!element) return;
  element.textContent = money(value);
  element.classList.toggle("is-negative", Number(value) < 0);
}

function rateToPercent(rate) {
  return (Number(rate || 0) * 100).toFixed(1);
}

function percentToRate(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  return number / 100;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function setupDailyReport() {
  const financeForm = document.querySelector("#financeForm");
  if (!financeForm) return;

  const receiptForm = document.querySelector("#receiptForm");
  const receiptFiles = document.querySelector("#receiptFiles");
  const receiptMessage = document.querySelector("#receiptMessage");
  const receiptList = document.querySelector("#receiptList");
  const receiptCount = document.querySelector("#receiptCount");
  const storeSelect = document.querySelector("#storeSelect");
  const reportDate = document.querySelector("#reportDate");
  const dailyMessage = document.querySelector("#dailyMessage");
  const incomeTotal = document.querySelector("#incomeTotal");
  const expenseTotal = document.querySelector("#expenseTotal");
  const dailyIncome = document.querySelector("#dailyIncome");
  const dailyExpense = document.querySelector("#dailyExpense");
  const dailyProfit = document.querySelector("#dailyProfit");
  const dailyProfitTable = document.querySelector("#dailyProfitTable");
  let currentReceipts = [];

  function amountFromForm(name) {
    const value = Number(financeForm.elements[name]?.value || 0);
    return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
  }

  function calculateDailyTotals() {
    const totalIncome = incomeFields.reduce((sum, field) => sum + amountFromForm(field), 0);
    const totalExpenses = expenseFields.reduce((sum, field) => sum + amountFromForm(field), 0);
    const profit = totalIncome - totalExpenses;

    setMoneyText(incomeTotal, totalIncome);
    setMoneyText(expenseTotal, totalExpenses);
    setMoneyText(dailyIncome, totalIncome);
    setMoneyText(dailyExpense, totalExpenses);
    setMoneyText(dailyProfit, profit);
    setMoneyText(dailyProfitTable, profit);
  }

  function clearDailyForm() {
    for (const field of [...incomeFields, ...expenseFields]) {
      financeForm.elements[field].value = 0;
    }
    financeForm.elements.note.value = "";
    calculateDailyTotals();
  }

  function fillDailyForm(report) {
    clearDailyForm();
    currentReceipts = report?.receipts || [];
    renderReceipts();
    if (!report) return;

    for (const field of incomeFields) {
      financeForm.elements[field].value = report.income?.[field] ?? 0;
    }
    for (const field of expenseFields) {
      financeForm.elements[field].value = report.expenses?.[field] ?? 0;
    }
    financeForm.elements.note.value = report.note || "";
    calculateDailyTotals();
  }

  function fileSizeLabel(size) {
    const bytes = Number(size || 0);
    if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
    if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} KB`;
    return `${bytes} B`;
  }

  function renderReceipts() {
    receiptCount.textContent = `${currentReceipts.length} 張`;
    if (!currentReceipts.length) {
      receiptList.innerHTML = `<div class="queue-empty">尚未上傳支出單據</div>`;
      return;
    }

    receiptList.innerHTML = currentReceipts
      .map((receipt) => `
        <article class="receipt-row">
          <div>
            <strong>${escapeHtml(receipt.name)}</strong>
            <span>${fileSizeLabel(receipt.size)}｜${new Date(receipt.uploadedAt).toLocaleString("zh-TW")}</span>
          </div>
          <div class="actions">
            <button type="button" class="secondary" data-open-receipt="${receipt.id}">查看</button>
            <button type="button" class="danger" data-delete-receipt="${receipt.id}">刪除</button>
          </div>
        </article>
      `)
      .join("");
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  function dailyPayload() {
    return {
      storeId: storeSelect.value,
      date: reportDate.value,
      income: {
        linePay: amountFromForm("linePay"),
        cash: amountFromForm("cash"),
        card: amountFromForm("card"),
        voucher: amountFromForm("voucher"),
        foodpanda: amountFromForm("foodpanda")
      },
      expenses: {
        seafood: amountFromForm("seafood"),
        meat: amountFromForm("meat"),
        supplies: amountFromForm("supplies"),
        vegetables: amountFromForm("vegetables"),
        otherFood: amountFromForm("otherFood"),
        ingredients: amountFromForm("ingredients")
      },
      note: financeForm.elements.note.value
    };
  }

  async function loadDailyReport() {
    if (!reportDate.value || !storeSelect.value) return;
    dailyMessage.textContent = "";

    const response = await financeFetch(
      `/api/finance/report?store=${encodeURIComponent(storeSelect.value)}&date=${encodeURIComponent(reportDate.value)}`
    );
    const data = await response.json();

    if (!response.ok) {
      dailyMessage.textContent = data.error || "讀取失敗";
      return;
    }

    fillDailyForm(data.report);
  }

  async function uploadReceipts() {
    if (!storeSelect.value || !reportDate.value) return;
    const files = Array.from(receiptFiles.files || []);
    if (!files.length) {
      receiptMessage.textContent = "請先選擇單據檔案。";
      return;
    }

    receiptMessage.textContent = "";
    const button = receiptForm.querySelector("button[type='submit']");
    button.disabled = true;
    button.textContent = "上傳中";

    try {
      const payloadFiles = [];
      for (const file of files) {
        payloadFiles.push({
          name: file.name,
          type: file.type,
          dataUrl: await fileToDataUrl(file)
        });
      }

      const response = await financeFetch("/api/finance/receipts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId: storeSelect.value,
          date: reportDate.value,
          files: payloadFiles
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "單據上傳失敗");

      receiptFiles.value = "";
      receiptMessage.textContent = "單據已上傳";
      await loadDailyReport();
    } catch (error) {
      receiptMessage.textContent = error.message;
    } finally {
      button.disabled = false;
      button.textContent = "上傳單據";
    }
  }

  async function openReceipt(receiptId) {
    const response = await financeFetch(`/api/finance/receipts/${encodeURIComponent(receiptId)}`);
    if (!response.ok) {
      const data = await response.json();
      receiptMessage.textContent = data.error || "無法開啟單據";
      return;
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  async function deleteReceipt(receiptId) {
    receiptMessage.textContent = "";
    const response = await financeFetch(`/api/finance/receipts/${encodeURIComponent(receiptId)}`, {
      method: "DELETE"
    });
    const data = await response.json();
    if (!response.ok) {
      receiptMessage.textContent = data.error || "刪除失敗";
      return;
    }
    receiptMessage.textContent = "單據已刪除";
    await loadDailyReport();
  }

  financeForm.addEventListener("input", calculateDailyTotals);

  receiptForm.addEventListener("submit", (event) => {
    event.preventDefault();
    uploadReceipts();
  });

  receiptList.addEventListener("click", (event) => {
    const openButton = event.target.closest("button[data-open-receipt]");
    if (openButton) {
      openReceipt(openButton.dataset.openReceipt);
      return;
    }

    const deleteButton = event.target.closest("button[data-delete-receipt]");
    if (deleteButton) {
      deleteReceipt(deleteButton.dataset.deleteReceipt);
    }
  });

  storeSelect.addEventListener("change", () => {
    loadDailyReport();
  });

  reportDate.addEventListener("change", () => {
    loadDailyReport();
  });

  financeForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    dailyMessage.textContent = "";

    const button = financeForm.querySelector("button[type='submit']");
    button.disabled = true;
    button.textContent = "儲存中";

    try {
      const response = await financeFetch("/api/finance/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dailyPayload())
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "儲存失敗");

      dailyMessage.textContent = "已儲存";
    } catch (error) {
      dailyMessage.textContent = error.message;
    } finally {
      button.disabled = false;
      button.textContent = "儲存日報表";
    }
  });

  async function initDailyReport() {
    const session = await requireFinanceSession("daily");
    if (!session) return;

    storeSelect.innerHTML = session.stores
      .map((store) => `<option value="${store.id}">${store.name}</option>`)
      .join("");
    storeSelect.disabled = session.stores.length === 1;
    reportDate.value = todayString();
    calculateDailyTotals();
    loadDailyReport();
  }

  initDailyReport();
}

function setupMonthlyReport() {
  const reportMonth = document.querySelector("#reportMonth");
  if (!reportMonth) return;

  const storeSelect = document.querySelector("#storeSelect");
  const monthlyMessage = document.querySelector("#monthlyMessage");
  const monthIncome = document.querySelector("#monthIncome");
  const monthExpense = document.querySelector("#monthExpense");
  const monthFees = document.querySelector("#monthFees");
  const monthProfit = document.querySelector("#monthProfit");
  const reportCount = document.querySelector("#reportCount");
  const dailyCount = document.querySelector("#dailyCount");
  const monthlySummaryRows = document.querySelector("#monthlySummaryRows");
  const dailyRows = document.querySelector("#dailyRows");
  const saveFeeRates = document.querySelector("#saveFeeRates");
  const linePayFee = document.querySelector("#linePayFee");
  const cardFee = document.querySelector("#cardFee");
  const foodpandaFee = document.querySelector("#foodpandaFee");

  function setFeeInputs(feeRates) {
    linePayFee.value = rateToPercent(feeRates.linePay);
    cardFee.value = rateToPercent(feeRates.card);
    foodpandaFee.value = rateToPercent(feeRates.foodpanda);
  }

  function monthlyRows(summary, feeRates) {
    const rows = [
      ["收入", "Line Pay", summary.income.linePay, `手續費 ${rateToPercent(feeRates.linePay)}% 另列支出`, ""],
      ["收入", "現金", summary.income.cash, "", ""],
      ["收入", "刷卡", summary.income.card, `手續費 ${rateToPercent(feeRates.card)}% 另列支出`, ""],
      ["收入", "禮券", summary.income.voucher, "", ""],
      ["收入", "熊貓", summary.income.foodpanda, `手續費 ${rateToPercent(feeRates.foodpanda)}% 另列支出`, ""],
      ["收入", "收入小計", summary.totalIncome, "", "is-total-row group-row"],
      ["支出", "海鮮", summary.expenses.seafood, "", ""],
      ["支出", "肉品", summary.expenses.meat, "", ""],
      ["支出", "雜物", summary.expenses.supplies, "", ""],
      ["支出", "菜品", summary.expenses.vegetables, "", ""],
      ["支出", "其他食品", summary.expenses.otherFood, "", ""],
      ["支出", "配料", summary.expenses.ingredients, "", ""],
      ["支出", "支出小計", summary.totalExpenses, "", "is-total-row group-row expense-group"],
      ["手續費", "Line Pay", summary.fees.linePay, "", ""],
      ["手續費", "刷卡", summary.fees.card, "", ""],
      ["手續費", "熊貓", summary.fees.foodpanda, "", ""],
      ["手續費", "手續費小計", summary.totalFees, "", "is-total-row group-row expense-group"],
      ["總結", "月盈餘", summary.monthlyProfit, "收入 - 支出 - 手續費", "is-total-row group-row profit-row"]
    ];

    return rows
      .map(([level, name, value, note, rowClass]) => `
        <tr class="${rowClass}">
          <td>${level}</td>
          <td class="${rowClass ? "" : "sub-item"}">${name}</td>
          <td>${money(value)}</td>
          <td>${note}</td>
        </tr>
      `)
      .join("");
  }

  function renderDailyRows(reports) {
    if (!reports.length) {
      dailyRows.innerHTML = `<tr><td colspan="6">這個月份尚無日報資料</td></tr>`;
      return;
    }

    dailyRows.innerHTML = reports
      .map((report) => `
        <tr>
          <td>${report.date}</td>
          <td>${money(report.totalIncome)}</td>
          <td>${money(report.totalExpenses)}</td>
          <td class="${Number(report.dailyProfit) < 0 ? "is-negative" : ""}">${money(report.dailyProfit)}</td>
          <td>${(report.receipts || []).length} 張</td>
          <td>${escapeHtml(report.note || "")}</td>
        </tr>
      `)
      .join("");
  }

  async function loadMonthlyReport() {
    if (!reportMonth.value || !storeSelect.value) return;
    monthlyMessage.textContent = "";

    const response = await financeFetch(
      `/api/finance/reports?store=${encodeURIComponent(storeSelect.value)}&month=${encodeURIComponent(reportMonth.value)}`
    );
    const data = await response.json();

    if (!response.ok) {
      monthlyMessage.textContent = data.error || "讀取失敗";
      return;
    }

    setFeeInputs(data.feeRates);
    setMoneyText(monthIncome, data.summary.totalIncome);
    setMoneyText(monthExpense, data.summary.totalExpenses);
    setMoneyText(monthFees, data.summary.totalFees);
    setMoneyText(monthProfit, data.summary.monthlyProfit);
    reportCount.textContent = `${data.summary.reportCount} 天`;
    dailyCount.textContent = `${data.reports.length} 筆`;
    monthlySummaryRows.innerHTML = monthlyRows(data.summary, data.feeRates);
    renderDailyRows(data.reports);
  }

  reportMonth.addEventListener("change", () => {
    loadMonthlyReport();
  });

  storeSelect.addEventListener("change", () => {
    loadMonthlyReport();
  });

  saveFeeRates.addEventListener("click", async () => {
    monthlyMessage.textContent = "";
    saveFeeRates.disabled = true;
    saveFeeRates.textContent = "儲存中";

    try {
      const response = await financeFetch("/api/finance/fee-rates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId: storeSelect.value,
          linePay: percentToRate(linePayFee.value),
          card: percentToRate(cardFee.value),
          foodpanda: percentToRate(foodpandaFee.value)
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "儲存失敗");

      setFeeInputs(data.feeRates);
      monthlyMessage.textContent = "手續費率已更新";
      await loadMonthlyReport();
    } catch (error) {
      monthlyMessage.textContent = error.message;
    } finally {
      saveFeeRates.disabled = false;
      saveFeeRates.textContent = "儲存費率";
    }
  });

  async function initMonthlyReport() {
    const session = await requireFinanceSession("monthly");
    if (!session) return;

    storeSelect.innerHTML = session.stores
      .map((store) => `<option value="${store.id}">${store.name}</option>`)
      .join("");
    storeSelect.disabled = session.stores.length === 1;
    reportMonth.value = currentMonthString();
    loadMonthlyReport();
  }

  initMonthlyReport();
}

setupDailyReport();
setupMonthlyReport();
