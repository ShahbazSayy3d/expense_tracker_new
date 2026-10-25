
const API_BASE = "http://127.0.0.1:3000/api";

const $ = (selector) => document.querySelector(selector);

const authSection = $("#auth-section");
const dashboardSection = $("#dashboard-section");

let currentUser = null;
let expenses = [];

const todayString = () => {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
};

function formatCurrency(value) {
    return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 2
    }).format(Number(value) || 0);
}

function formatDate(value) {
    if (!value) return "—";
    const parts = value.slice(0, 10).split("-").map(Number);
    if (parts.length !== 3 || parts.some(Number.isNaN)) return value;
    return new Intl.DateTimeFormat("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric"
    }).format(new Date(parts[0], parts[1] - 1, parts[2]));
}

async function apiRequest(path, options = {}) {
    const config = {
        method: options.method || "GET",
        credentials: "include",
        headers: {}
    };

    if (options.body !== undefined) {
        config.headers["Content-Type"] = "application/json";
        config.body = JSON.stringify(options.body);
    }

    const response = await fetch(`${API_BASE}${path}`, config);
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.error || "Something went wrong. Please try again.");
    }

    return data;
}

function showMessage(selector, message, isError = false) {
    const element = $(selector);
    if (!element) return;

    element.textContent = message;
    element.classList.toggle("error-message", isError);
    element.style.color = isError ? "#ff8585" : "#45dc91";
}

function clearMessage(selector) {
    showMessage(selector, "");
}

// ==================== AUTHENTICATION ====================

function switchAuthPanel(panel) {
    $("#login-panel").hidden = panel !== "login";
    $("#register-panel").hidden = panel !== "register";
    $("#forgot-panel").hidden = panel !== "forgot";

    $("#login-tab").classList.toggle("active", panel === "login");
    $("#register-tab").classList.toggle("active", panel === "register");

    $("#login-tab").setAttribute("aria-selected", String(panel === "login"));
    $("#register-tab").setAttribute("aria-selected", String(panel === "register"));

    clearMessage("#login-message");
    clearMessage("#register-message");
    clearMessage("#forgot-message");
}

function setLoggedIn(user) {
    currentUser = user;
    authSection.hidden = true;
    dashboardSection.hidden = false;
    $("#dashboard-name").textContent = user.name || "there";

    $("#expense-date").max = todayString();

    loadExpenses().catch(error => {
        showMessage("#expense-message", error.message, true);
    });
}

function setLoggedOut() {
    currentUser = null;
    expenses = [];

    dashboardSection.hidden = true;
    authSection.hidden = false;

    $("#login-form").reset();
    $("#register-form").reset();
    $("#forgot-form").reset();

    $("#expense-list").replaceChildren();
    $("#report-table-body").replaceChildren();

    updateDashboardTotals();
    renderReport();
    resetExpenseForm();
    switchAuthPanel("login");
}

$("#login-tab").addEventListener("click", () => switchAuthPanel("login"));
$("#register-tab").addEventListener("click", () => switchAuthPanel("register"));

document.querySelectorAll("[data-switch]").forEach(button => {
    button.addEventListener("click", () => switchAuthPanel(button.dataset.switch));
});

$("#forgot-password-link").addEventListener("click", () => switchAuthPanel("forgot"));

$("#login-form").addEventListener("submit", async event => {
    event.preventDefault();
    showMessage("#login-message", "Signing in...");

    try {
        const data = await apiRequest("/auth/login", {
            method: "POST",
            body: {
                email: $("#login-email").value.trim(),
                password: $("#login-password").value
            }
        });

        setLoggedIn(data.user);
        showMessage("#expense-message", "Signed in successfully.");
    } catch (error) {
        showMessage("#login-message", error.message, true);
    }
});

$("#register-form").addEventListener("submit", async event => {
    event.preventDefault();
    showMessage("#register-message", "Creating your account...");

    try {
        const data = await apiRequest("/auth/register", {
            method: "POST",
            body: {
                name: $("#register-name").value.trim(),
                email: $("#register-email").value.trim(),
                password: $("#register-password").value
            }
        });

        setLoggedIn(data.user);
        showMessage("#expense-message", "Account created successfully.");
    } catch (error) {
        showMessage("#register-message", error.message, true);
    }
});

$("#forgot-form").addEventListener("submit", async event => {
    event.preventDefault();
    showMessage("#forgot-message", "Sending request...");

    try {
        const data = await apiRequest("/auth/forgot-password", {
            method: "POST",
            body: { email: $("#forgot-email").value.trim() }
        });

        showMessage("#forgot-message", data.message || "Request processed.");
    } catch (error) {
        showMessage("#forgot-message", error.message, true);
    }
});

$("#logout-button").addEventListener("click", async () => {
    try {
        await apiRequest("/auth/logout", { method: "POST", body: {} });
        setLoggedOut();
    } catch (error) {
        alert(error.message);
    }
});

// ==================== DASHBOARD TOTALS ====================

function updateDashboardTotals() {
    const today = todayString();
    const month = today.slice(0, 7);

    const monthlyTotal = expenses
        .filter(item => item.date && item.date.slice(0, 7) === month)
        .reduce((sum, item) => sum + item.amount, 0);

    const overallTotal = expenses.reduce((sum, item) => sum + item.amount, 0);

    $("#monthly-total").textContent = formatCurrency(monthlyTotal);
    $("#overall-total").textContent = formatCurrency(overallTotal);
    $("#expense-count").textContent = String(expenses.length);
}

// ==================== EXPENSE HISTORY ====================

function createExpenseRow(expense) {
    const row = document.createElement("article");
    row.className = "expense-row";

    const main = document.createElement("div");
    main.className = "expense-row-main";

    const title = document.createElement("strong");
    title.textContent = expense.description;

    const details = document.createElement("span");
    details.textContent = `${expense.category} · ${formatDate(expense.date)}`;

    main.append(title, details);

    const side = document.createElement("div");
    side.className = "expense-row-side";

    const amount = document.createElement("strong");
    amount.textContent = formatCurrency(expense.amount);

    const actions = document.createElement("div");
    actions.className = "expense-row-actions";

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "secondary-button";
    editButton.textContent = "Edit";
    editButton.addEventListener("click", () => beginEdit(expense));

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "secondary-button";
    deleteButton.textContent = "Delete";
    deleteButton.addEventListener("click", () => deleteExpense(expense.id));

    actions.append(editButton, deleteButton);
    side.append(amount, actions);
    row.append(main, side);

    return row;
}

function renderExpenses() {
    const list = $("#expense-list");
    list.replaceChildren();

    if (expenses.length === 0) {
        const empty = document.createElement("p");
        empty.className = "empty-state";
        empty.textContent = "No expenses yet. Add your first expense above.";
        list.appendChild(empty);
        return;
    }

    const sorted = [...expenses].sort((a, b) =>
        b.date.localeCompare(a.date) || b.id - a.id
    );

    sorted.forEach(expense => list.appendChild(createExpenseRow(expense)));
}

async function loadExpenses() {
    const data = await apiRequest("/expenses");
    const records = Array.isArray(data.expenses) ? data.expenses : [];

    expenses = records.map(item => ({
        ...item,
        id: Number(item.id),
        amount: Number(item.amount),
        date: String(item.date || item.expense_date || "").slice(0, 10)
    })).filter(item =>
        Number.isFinite(item.id) &&
        Number.isFinite(item.amount) &&
        /^\d{4}-\d{2}-\d{2}$/.test(item.date)
    );

    renderExpenses();
    updateDashboardTotals();
    renderReport();
}

function beginEdit(expense) {
    $("#expense-id").value = expense.id;
    $("#expense-amount").value = expense.amount;
    $("#expense-category").value = expense.category;
    $("#expense-date").value = expense.date;
    $("#expense-description").value = expense.description;

    $("#expense-form-title").textContent = "Edit expense";
    $("#save-expense-button").textContent = "Update expense";
    $("#cancel-edit-button").hidden = false;

    $("#expense-form").scrollIntoView({ behavior: "smooth", block: "center" });
}

function resetExpenseForm() {
    $("#expense-form").reset();
    $("#expense-id").value = "";
    $("#expense-date").value = todayString();
    $("#expense-date").max = todayString();

    $("#expense-form-title").textContent = "Add an expense";
    $("#save-expense-button").textContent = "Save expense";
    $("#cancel-edit-button").hidden = true;
}

$("#expense-form").addEventListener("submit", async event => {
    event.preventDefault();

    const id = $("#expense-id").value;
    const body = {
        amount: $("#expense-amount").value,
        category: $("#expense-category").value,
        date: $("#expense-date").value,
        description: $("#expense-description").value.trim()
    };

    if (body.date > todayString()) {
        showMessage("#expense-message", "Expense date cannot be in the future.", true);
        return;
    }

    try {
        const data = await apiRequest(
            id ? `/expenses/${encodeURIComponent(id)}` : "/expenses",
            { method: id ? "PUT" : "POST", body }
        );

        resetExpenseForm();
        await loadExpenses();
        showMessage("#expense-message", data.message || "Expense saved.");
    } catch (error) {
        showMessage("#expense-message", error.message, true);
    }
});

$("#cancel-edit-button").addEventListener("click", resetExpenseForm);

async function deleteExpense(id) {
    const expense = expenses.find(item => item.id === id);
    if (!expense) return;

    if (!confirm(`Delete "${expense.description}" (${formatCurrency(expense.amount)})?`)) {
        return;
    }

    try {
        await apiRequest(`/expenses/${encodeURIComponent(id)}`, {
            method: "DELETE"
        });

        if ($("#expense-id").value === String(id)) resetExpenseForm();

        await loadExpenses();
        showMessage("#expense-message", "Expense deleted.");
    } catch (error) {
        showMessage("#expense-message", error.message, true);
    }
}

$("#refresh-expenses").addEventListener("click", async () => {
    try {
        await loadExpenses();
        showMessage("#expense-message", "Expenses refreshed.");
    } catch (error) {
        showMessage("#expense-message", error.message, true);
    }
});

// ==================== REPORT DATE RANGE ====================

function parseDate(dateString) {
    const [year, month, day] = dateString.split("-").map(Number);
    return new Date(year, month - 1, day);
}

function dateToString(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function getWeekStart(date) {
    const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const day = result.getDay();
    result.setDate(result.getDate() - (day === 0 ? 6 : day - 1));
    return result;
}

function getReportRange() {
    const period = $("#report-period").value;
    const today = todayString();

    if (period === "week") {
        return {
            start: dateToString(getWeekStart(parseDate(today))),
            end: today,
            label: "This week"
        };
    }

    if (period === "month") {
        return {
            start: `${today.slice(0, 7)}-01`,
            end: today,
            label: "This month"
        };
    }

    if (period === "year") {
        return {
            start: `${today.slice(0, 4)}-01-01`,
            end: today,
            label: "This year"
        };
    }

    const start = $("#report-start-date").value;
    const end = $("#report-end-date").value;

    if (!start || !end) {
        throw new Error("Select both the start and end dates.");
    }

    if (start > end) {
        throw new Error("The start date cannot be after the end date.");
    }

    if (start > today || end > today) {
        throw new Error("Report dates cannot be in the future.");
    }

    return { start, end, label: "Custom range" };
}

function getReportExpenses() {
    const range = getReportRange();

    const selected = expenses
        .filter(item => item.date >= range.start && item.date <= range.end)
        .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);

    return { range, selected };
}

function updateReportDateFields() {
    const custom = $("#report-period").value === "custom";

    $("#report-start-group").hidden = !custom;
    $("#report-end-group").hidden = !custom;

    $("#report-start-date").max = todayString();
    $("#report-end-date").max = todayString();

    showMessage("#report-message", "");
}

$("#report-period").addEventListener("change", updateReportDateFields);
$("#apply-report-button").addEventListener("click", renderReport);

function renderReport() {
    const tableBody = $("#report-table-body");
    tableBody.replaceChildren();

    try {
        const { range, selected } = getReportExpenses();

        const total = selected.reduce((sum, item) => sum + item.amount, 0);
        const average = selected.length ? total / selected.length : 0;

        $("#report-total").textContent = formatCurrency(total);
        $("#report-count").textContent = String(selected.length);
        $("#report-average").textContent = formatCurrency(average);

        if (selected.length === 0) {
            const row = document.createElement("tr");
            const cell = document.createElement("td");
            cell.colSpan = 4;
            cell.className = "table-empty";
            cell.textContent = `No expenses found for ${range.label.toLowerCase()}.`;
            row.appendChild(cell);
            tableBody.appendChild(row);
        } else {
            selected.forEach(item => {
                const row = document.createElement("tr");

                const dateCell = document.createElement("td");
                dateCell.textContent = formatDate(item.date);

                const descriptionCell = document.createElement("td");
                descriptionCell.textContent = item.description;

                const categoryCell = document.createElement("td");
                categoryCell.textContent = item.category;

                const amountCell = document.createElement("td");
                amountCell.className = "numeric-cell";
                amountCell.textContent = formatCurrency(item.amount);

                row.append(dateCell, descriptionCell, categoryCell, amountCell);
                tableBody.appendChild(row);
            });
        }

        showMessage(
            "#report-message",
            `${range.label}: ${formatDate(range.start)} – ${formatDate(range.end)}`
        );
    } catch (error) {
        $("#report-total").textContent = formatCurrency(0);
        $("#report-count").textContent = "0";
        $("#report-average").textContent = formatCurrency(0);

        const row = document.createElement("tr");
        const cell = document.createElement("td");
        cell.colSpan = 4;
        cell.className = "table-empty";
        cell.textContent = error.message;
        row.appendChild(cell);
        tableBody.appendChild(row);

        showMessage("#report-message", error.message, true);
    }
}

// ==================== EXCEL EXPORT ====================

$("#export-excel-button").addEventListener("click", () => {
    try {
        if (typeof XLSX === "undefined") {
            throw new Error("Excel library did not load. Check your internet connection and reload the page.");
        }

        const { range, selected } = getReportExpenses();

        if (selected.length === 0) {
            throw new Error("There are no expenses in the selected period to export.");
        }

        const rows = selected.map(item => ({
            Date: item.date,
            Description: item.description,
            Category: item.category,
            "Amount (INR)": item.amount
        }));

        const total = selected.reduce((sum, item) => sum + item.amount, 0);

        const summaryRows = [
            { Metric: "Report period", Value: range.label },
            { Metric: "From date", Value: range.start },
            { Metric: "To date", Value: range.end },
            { Metric: "Transactions", Value: selected.length },
            { Metric: "Total expenses (INR)", Value: Number(total.toFixed(2)) },
            { Metric: "Average transaction (INR)", Value: Number((total / selected.length).toFixed(2)) },
            { Metric: "Generated on", Value: todayString() }
        ];

        const workbook = XLSX.utils.book_new();
        const expenseSheet = XLSX.utils.json_to_sheet(rows);
        const summarySheet = XLSX.utils.json_to_sheet(summaryRows);

        expenseSheet["!cols"] = [
            { wch: 14 },
            { wch: 34 },
            { wch: 20 },
            { wch: 18 }
        ];

        summarySheet["!cols"] = [
            { wch: 30 },
            { wch: 24 }
        ];

        XLSX.utils.book_append_sheet(workbook, summarySheet, "Report Summary");
        XLSX.utils.book_append_sheet(workbook, expenseSheet, "Expenses");

        const filePeriod = `${range.start}_to_${range.end}`;
        XLSX.writeFile(workbook, `expense-report-${filePeriod}.xlsx`);

        showMessage("#report-message", `Excel report downloaded: ${selected.length} transaction(s).`);
    } catch (error) {
        showMessage("#report-message", error.message, true);
    }
});

// ==================== THEME / FOOTER ====================

$("#current-year").textContent = new Date().getFullYear();
$("#expense-date").value = todayString();
$("#expense-date").max = todayString();

$("#support-button").addEventListener("click", () => {
    alert("Your Buy Me a Coffee payment link will be connected here.");
});

// ==================== RESTORE SESSION ====================

async function restoreSession() {
    updateReportDateFields();

    try {
        const data = await apiRequest("/auth/me");
        setLoggedIn(data.user);
    } catch {
        setLoggedOut();
    }
}

restoreSession();
