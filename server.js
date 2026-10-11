const express = require('express');
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

if (!fs.existsSync('./public/uploads')) {
    fs.mkdirSync('./public/uploads', { recursive: true });
}

const storage = multer.diskStorage({
    destination: './public/uploads/',
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

const db = new sqlite3.Database('./database.db', (err) => {
    if (err) console.error("DB Error:", err.message);
    else console.log("Database connected successfully.");
});

// Create tables
db.serialize(() => {
    // Users table
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT,
        role TEXT DEFAULT 'user'
    )`);

    // Default admin user
    db.run(`INSERT OR IGNORE INTO users (id, username, password, role) VALUES (1, 'admin', 'admin123', 'admin')`);

    // Approved Phones (Catalog)
    db.run(`CREATE TABLE IF NOT EXISTS phones (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT,
        brand TEXT,
        model TEXT,
        price TEXT,
        condition TEXT,
        phone_number TEXT,
        description TEXT,
        image TEXT,
        status TEXT DEFAULT 'approved',
        user_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Submissions (Pending Requests for Admin)
    db.run(`CREATE TABLE IF NOT EXISTS requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        username TEXT,
        title TEXT,
        brand TEXT,
        model TEXT,
        price TEXT,
        condition TEXT,
        phone_number TEXT,
        description TEXT,
        image TEXT,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Custom Orders
    db.run(`CREATE TABLE IF NOT EXISTS custom_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        username TEXT,
        brand TEXT,
        model TEXT,
        budget TEXT,
        phone_number TEXT,
        details TEXT,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

app.use(session({
    secret: process.env.SESSION_SECRET || 'secret',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// Auth Middlewares
const requireAuth = (req, res, next) => {
    if (!req.session.user) {
        return res.status(401).json({ error: "Avval tizimga kiring!" });
    }
    next();
};

const requireAdmin = (req, res, next) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).json({ error: "Ruxsat berilmagan! Faqat Admin uchun." });
    }
    next();
};

// Auth API Routes
app.post('/api/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Login va parol kiritilishi shart!" });

    db.run("INSERT INTO users (username, password) VALUES (?, ?)", [username, password], function(err) {
        if (err) {
            return res.status(400).json({ error: "Bu login allaqachon mavjud!" });
        }
        req.session.user = { id: this.lastID, username, role: 'user' };
        res.json({ success: true, user: req.session.user });
    });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.get("SELECT * FROM users WHERE username = ? AND password = ?", [username, password], (err, row) => {
        if (err || !row) {
            return res.status(400).json({ error: "Login yoki parol noto'g'ri!" });
        }
        req.session.user = { id: row.id, username: row.username, role: row.role };
        res.json({ success: true, user: req.session.user });
    });
});

app.get('/api/me', (req, res) => {
    if (req.session.user) {
        res.json({ loggedIn: true, user: req.session.user });
    } else {
        res.json({ loggedIn: false });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// Phone Catalog API
app.get('/api/phones', (req, res) => {
    const { brand, model } = req.query;
    let sql = "SELECT * FROM phones WHERE status = 'approved'";
    let params = [];

    if (brand) {
        sql += " AND LOWER(brand) = LOWER(?)";
        params.push(brand);
    }
    if (model) {
        sql += " AND LOWER(model) = LOWER(?)";
        params.push(model);
    }

    sql += " ORDER BY id DESC";

    db.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// User Submits Phone for Approval (Adminga Zapros)
app.post('/api/sell-request', requireAuth, upload.single('image'), (req, res) => {
    const { title, brand, model, price, condition, phone_number, description } = req.body;
    const image = req.file ? `/uploads/${req.file.filename}` : 'https://via.placeholder.com/300x200?text=No+Image';

    const sql = `INSERT INTO requests (user_id, username, title, brand, model, price, condition, phone_number, description, image)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    db.run(sql, [req.session.user.id, req.session.user.username, title, brand, model, price, condition, phone_number, description, image], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.redirect('/request-sent.html');
    });
});

// User Custom Order
app.post('/api/custom-order', requireAuth, (req, res) => {
    const { brand, model, budget, phone_number, details } = req.body;
    const sql = `INSERT INTO custom_orders (user_id, username, brand, model, budget, phone_number, details) VALUES (?, ?, ?, ?, ?, ?, ?)`;
    db.run(sql, [req.session.user.id, req.session.user.username, brand, model, budget, phone_number, details], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.redirect('/order-success.html');
    });
});

// ADMIN API ENDPOINTS
app.get('/api/admin/requests', requireAdmin, (req, res) => {
    db.all("SELECT * FROM requests WHERE status = 'pending' ORDER BY id DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.get('/api/admin/orders', requireAdmin, (req, res) => {
    db.all("SELECT * FROM custom_orders ORDER BY id DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/admin/approve-request/:id', requireAdmin, (req, res) => {
    const requestId = req.params.id;
    db.get("SELECT * FROM requests WHERE id = ?", [requestId], (err, reqData) => {
        if (err || !reqData) return res.status(404).json({ error: "Zapros topilmadi!" });

        // Add to phones
        const sqlInsert = `INSERT INTO phones (title, brand, model, price, condition, phone_number, description, image, user_id)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        db.run(sqlInsert, [reqData.title, reqData.brand, reqData.model, reqData.price, reqData.condition, reqData.phone_number, reqData.description, reqData.image, reqData.user_id], function(err2) {
            if (err2) return res.status(500).json({ error: err2.message });

            // Update request status
            db.run("UPDATE requests SET status = 'approved' WHERE id = ?", [requestId], () => {
                res.json({ success: true });
            });
        });
    });
});

app.post('/api/admin/reject-request/:id', requireAdmin, (req, res) => {
    const requestId = req.params.id;
    db.run("UPDATE requests SET status = 'rejected' WHERE id = ?", [requestId], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

app.listen(PORT, () => {
    console.log(`MOBILE KING V2 server running on port ${PORT}`);
});
