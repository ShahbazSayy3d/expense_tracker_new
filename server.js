
require("dotenv").config();

const express = require("express");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const session = require("express-session");
const cors = require("cors");

const app = express();
const PORT = Number(process.env.PORT) || 3000;

if (!process.env.SESSION_SECRET) {
    throw new Error("SESSION_SECRET missing from .env");
}

const pool = mysql.createPool({
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "expense_tracker_v2",
    waitForConnections: true,
    connectionLimit: 10,
    dateStrings: true
});

app.use(cors({
    origin: process.env.FRONTEND_URL || "http://127.0.0.1:5500",
    credentials: true
}));

app.use(express.json());

app.use(session({
    name: "expense_tracker_sid",
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: false,
        maxAge: 24 * 60 * 60 * 1000
    }
}));

function requireLogin(req, res, next) {
    if (!req.session.userId) {
        return res.status(401).json({ error: "Please sign in first." });
    }
    next();
}

app.get("/api/health", async (req, res) => {
    try {
        await pool.query("SELECT 1");
        res.json({ status: "ok", database: "connected" });
    } catch (error) {
        console.error(error.message);
        res.status(500).json({ status: "error", database: "unavailable" });
    }
});

app.post("/api/auth/register", async (req, res) => {
    try {
        const { name, email, password } = req.body || {};

        if (typeof name !== "string" || !name.trim() ||
            name.trim().length > 100 ||
            typeof email !== "string" ||
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
            typeof password !== "string" ||
            password.length < 8 || password.length > 72) {
            return res.status(400).json({
                error: "Enter a valid name, email and password of 8–72 characters."
            });
        }

        const normalizedEmail = email.trim().toLowerCase();
        const hash = await bcrypt.hash(password, 12);

        const [result] = await pool.execute(
            "INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)",
            [name.trim(), normalizedEmail, hash]
        );

        req.session.regenerate((error) => {
            if (error) {
                return res.status(500).json({ error: "Could not start session." });
            }

            req.session.userId = result.insertId;
            req.session.userName = name.trim();

            req.session.save((saveError) => {
                if (saveError) {
                    return res.status(500).json({ error: "Could not save session." });
                }

                res.status(201).json({
                    message: "Account created.",
                    user: {
                        id: result.insertId,
                        name: name.trim(),
                        email: normalizedEmail
                    }
                });
            });
        });
    } catch (error) {
        if (error.code === "ER_DUP_ENTRY") {
            return res.status(409).json({ error: "Email already registered." });
        }
        console.error(error.message);
        res.status(500).json({ error: "Registration failed." });
    }
});

app.post("/api/auth/login", async (req, res) => {
    try {
        const { email, password } = req.body || {};

        if (typeof email !== "string" || typeof password !== "string") {
            return res.status(400).json({ error: "Enter email and password." });
        }

        const [users] = await pool.execute(
            "SELECT id, name, email, password_hash FROM users WHERE email = ?",
            [email.trim().toLowerCase()]
        );

        if (!users.length || !(await bcrypt.compare(password, users[0].password_hash))) {
            return res.status(401).json({ error: "Invalid email or password." });
        }

        const user = users[0];

        req.session.regenerate((error) => {
            if (error) {
                return res.status(500).json({ error: "Could not start session." });
            }

            req.session.userId = user.id;
            req.session.userName = user.name;

            req.session.save((saveError) => {
                if (saveError) {
                    return res.status(500).json({ error: "Could not save session." });
                }

                res.json({
                    message: "Signed in.",
                    user: { id: user.id, name: user.name, email: user.email }
                });
            });
        });
    } catch (error) {
        console.error(error.message);
        res.status(500).json({ error: "Login failed." });
    }
});

app.get("/api/auth/me", requireLogin, async (req, res) => {
    try {
        const [users] = await pool.execute(
            "SELECT id, name, email FROM users WHERE id = ?",
            [req.session.userId]
        );

        if (!users.length) {
            return res.status(401).json({ error: "Account not found." });
        }

        res.json({ user: users[0] });
    } catch (error) {
        console.error(error.message);
        res.status(500).json({ error: "Could not load account." });
    }
});

app.post("/api/auth/logout", (req, res) => {
    req.session.destroy((error) => {
        if (error) {
            return res.status(500).json({ error: "Sign out failed." });
        }

        res.clearCookie("expense_tracker_sid", {
            httpOnly: true,
            sameSite: "lax",
            secure: false
        });

        res.json({ message: "Signed out." });
    });
});

app.get("/api/expenses", requireLogin, async (req, res) => {
    try {
        const [expenses] = await pool.execute(
            `SELECT id, amount, category, description,
                    DATE_FORMAT(expense_date, '%Y-%m-%d') AS date
             FROM expenses
             WHERE user_id = ?
             ORDER BY expense_date DESC, id DESC`,
            [req.session.userId]
        );

        res.json({ expenses });
    } catch (error) {
        console.error(error.message);
        res.status(500).json({ error: "Could not load expenses." });
    }
});

app.post("/api/expenses", requireLogin, async (req, res) => {
    try {
        const { amount, category, description, date } = req.body || {};
        const value = Number(amount);

        if (!Number.isFinite(value) || value <= 0 || value > 99999999 ||
            typeof category !== "string" || !category.trim() ||
            category.trim().length > 100 ||
            typeof description !== "string" || !description.trim() ||
            description.trim().length > 255 ||
            typeof date !== "string" ||
            !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
            Number.isNaN(Date.parse(date))) {
            return res.status(400).json({ error: "Invalid expense details." });
        }

        const [result] = await pool.execute(
            `INSERT INTO expenses
                (user_id, amount, category, description, expense_date)
             VALUES (?, ?, ?, ?, ?)`,
            [req.session.userId, value.toFixed(2),
             category.trim(), description.trim(), date]
        );

        res.status(201).json({
            message: "Expense saved.",
            id: result.insertId
        });
    } catch (error) {
        console.error(error.message);
        res.status(500).json({ error: "Could not save expense." });
    }
});

app.put("/api/expenses/:id", requireLogin, async (req, res) => {
    try {
        const id = Number(req.params.id);
        const { amount, category, description, date } = req.body || {};
        const value = Number(amount);

        if (!Number.isSafeInteger(id) || id < 1 ||
            !Number.isFinite(value) || value <= 0 || value > 99999999 ||
            typeof category !== "string" || !category.trim() ||
            category.trim().length > 100 ||
            typeof description !== "string" || !description.trim() ||
            description.trim().length > 255 ||
            typeof date !== "string" ||
            !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
            Number.isNaN(Date.parse(date))) {
            return res.status(400).json({ error: "Invalid expense details." });
        }

        const [result] = await pool.execute(
            `UPDATE expenses
             SET amount = ?, category = ?, description = ?, expense_date = ?
             WHERE id = ? AND user_id = ?`,
            [value.toFixed(2), category.trim(), description.trim(),
             date, id, req.session.userId]
        );

        if (!result.affectedRows) {
            return res.status(404).json({ error: "Expense not found." });
        }

        res.json({ message: "Expense updated." });
    } catch (error) {
        console.error(error.message);
        res.status(500).json({ error: "Could not update expense." });
    }
});

app.delete("/api/expenses/:id", requireLogin, async (req, res) => {
    try {
        const id = Number(req.params.id);

        if (!Number.isSafeInteger(id) || id < 1) {
            return res.status(400).json({ error: "Invalid expense ID." });
        }

        const [result] = await pool.execute(
            "DELETE FROM expenses WHERE id = ? AND user_id = ?",
            [id, req.session.userId]
        );

        if (!result.affectedRows) {
            return res.status(404).json({ error: "Expense not found." });
        }

        res.json({ message: "Expense deleted." });
    } catch (error) {
        console.error(error.message);
        res.status(500).json({ error: "Could not delete expense." });
    }
});

app.listen(PORT, "127.0.0.1", () => {
    console.log(`Expense Tracker backend running at http://127.0.0.1:${PORT}`);
});
