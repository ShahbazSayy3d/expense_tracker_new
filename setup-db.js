
require("dotenv").config();
const mysql = require("mysql2/promise");

async function setupDatabase() {
    let connection;

    try {
        connection = await mysql.createConnection({
            host: process.env.DB_HOST || "localhost",
            port: Number(process.env.DB_PORT || 3306),
            user: process.env.DB_USER || "root",
            password: process.env.DB_PASSWORD || ""
        });

        const databaseName = process.env.DB_NAME || "expense_tracker_v2";

        if (!/^[a-zA-Z0-9_]+$/.test(databaseName)) {
            throw new Error("Invalid database name in .env");
        }

        await connection.query(
            `CREATE DATABASE IF NOT EXISTS \`${databaseName}\`
             CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
        );

        await connection.query(`USE \`${databaseName}\``);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS users (
                id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                email VARCHAR(255) NOT NULL UNIQUE,
                password_hash VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS expenses (
                id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                user_id INT UNSIGNED NOT NULL,
                amount DECIMAL(10,2) NOT NULL,
                category VARCHAR(100) NOT NULL,
                description VARCHAR(255) NOT NULL,
                expense_date DATE NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_expenses_user_date (user_id, expense_date),
                CONSTRAINT fk_expenses_user
                    FOREIGN KEY (user_id) REFERENCES users(id)
                    ON DELETE CASCADE
            ) ENGINE=InnoDB
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS password_resets (
                id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                user_id INT UNSIGNED NOT NULL,
                token_hash CHAR(64) NOT NULL UNIQUE,
                expires_at DATETIME NOT NULL,
                used_at DATETIME NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_password_reset_user (user_id),
                CONSTRAINT fk_password_reset_user
                    FOREIGN KEY (user_id) REFERENCES users(id)
                    ON DELETE CASCADE
            ) ENGINE=InnoDB
        `);

        const [tables] = await connection.query("SHOW TABLES");

        console.log("Database setup successful:", databaseName);
        console.log("Tables:");
        tables.forEach((table) => console.log(" -", Object.values(table)[0]));
    } catch (error) {
        console.error("Database setup failed:", error.message);
        process.exitCode = 1;
    } finally {
        if (connection) await connection.end();
    }
}

setupDatabase();
