const express = require('express');
const session = require('express-session');
const { Pool } = require('pg');
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

// Supabase (PostgreSQL) ulanishi
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

pool.connect((err, client, release) => {
    if (err) {
        console.error("Database connection error:", err.stack);
    } else {
        console.log("Database connected successfully.");
        release();
    }
});

// Online foydalanuvchilarni saqlash uchun Map
const onlineUsers = new Map();

setInterval(() => {
    const now = Date.now();
    for (let [sessionId, data] of onlineUsers.entries()) {
        if (now - data.lastActive > 10 * 60 * 1000) {
            onlineUsers.delete(sessionId);
        }
    }
}, 60 * 1000);

// Jadval yaratish funksiyasi
async function initDB() {
    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            username TEXT UNIQUE,
            password TEXT,
            role TEXT DEFAULT 'user'
        )`);

        await pool.query(`INSERT INTO users (id, username, password, role) 
                          VALUES (1, 'admin', 'admin123', 'admin') 
                          ON CONFLICT (username) DO NOTHING`);

        await pool.query(`CREATE TABLE IF NOT EXISTS phones (
            id SERIAL PRIMARY KEY,
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
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        await pool.query(`CREATE TABLE IF NOT EXISTS requests (
            id SERIAL PRIMARY KEY,
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
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        await pool.query(`CREATE TABLE IF NOT EXISTS custom_orders (
            id SERIAL PRIMARY KEY,
            user_id INTEGER,
            username TEXT,
            brand TEXT,
            model TEXT,
            budget TEXT,
            phone_number TEXT,
            details TEXT,
            status TEXT DEFAULT 'pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
        console.log("Tables initialized successfully.");
    } catch (err) {
        console.error("Table creation error:", err.message);
    }
}

initDB();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

app.use(session({
    secret: process.env.SESSION_SECRET || 'secret',
    resave: true,
    saveUninitialized: true,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// UptimeRobot uchun ping endpointi
app.get('/ping', (req, res) => {
    res.status(200).send('pong');
});

// Har bir so'rovda foydalanuvchining onlayn vaqtini yangilash
app.use((req, res, next) => {
    if (req.session && req.session.user) {
        onlineUsers.set(req.sessionID, {
            username: req.session.user.username,
            lastActive: Date.now()
        });
    }
    next();
});

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

app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Login va parol kiritilishi shart!" });

    try {
        const result = await pool.query(
            "INSERT INTO users (username, password) VALUES ($1, $2) RETURNING id",
            [username, password]
        );
        const userId = result.rows[0].id;
        req.session.user = { id: userId, username, role: 'user' };
        onlineUsers.set(req.sessionID, { username, lastActive: Date.now() });
        res.json({ success: true, user: req.session.user });
    } catch (err) {
        res.status(400).json({ error: "Bu login allaqachon mavjud!" });
    }
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await pool.query(
            "SELECT * FROM users WHERE username = $1 AND password = $2",
            [username, password]
        );
        if (result.rows.length === 0) {
            return res.status(400).json({ error: "Login yoki parol noto'g'ri!" });
        }
        const row = result.rows[0];
        req.session.user = { id: row.id, username: row.username, role: row.role };
        onlineUsers.set(req.sessionID, { username: row.username, lastActive: Date.now() });
        res.json({ success: true, user: req.session.user });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/me', (req, res) => {
    if (req.session.user) {
        res.json({ loggedIn: true, user: req.session.user });
    } else {
        res.json({ loggedIn: false });
    }
});

app.post('/api/logout', (req, res) => {
    if (req.sessionID) {
        onlineUsers.delete(req.sessionID);
    }
    req.session.destroy();
    res.json({ success: true });
});

app.get('/api/phones', async (req, res) => {
    const { brand, model } = req.query;
    let sql = "SELECT * FROM phones WHERE status = 'approved'";
    let params = [];
    let paramIndex = 1;

    if (brand) {
        sql += ` AND LOWER(brand) = LOWER($${paramIndex++})`;
        params.push(brand);
    }
    if (model) {
        sql += ` AND LOWER(model) = LOWER($${paramIndex++})`;
        params.push(model);
    }

    sql += " ORDER BY id DESC";

    try {
        const result = await pool.query(sql, params);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/sell-request', requireAuth, upload.single('image'), async (req, res) => {
    const { title, brand, model, price, condition, phone_number, description } = req.body;
    const image = req.file ? `/uploads/${req.file.filename}` : 'https://via.placeholder.com/300x200?text=No+Image';

    const sql = `INSERT INTO requests (user_id, username, title, brand, model, price, condition, phone_number, description, image)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`;
    try {
        await pool.query(sql, [
            req.session.user.id,
            req.session.user.username,
            title,
            brand,
            model,
            price,
            condition,
            phone_number,
            description,
            image
        ]);
        res.redirect('/request-sent.html');
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/custom-order', requireAuth, async (req, res) => {
    const { brand, model, budget, phone_number, details } = req.body;
    const sql = `INSERT INTO custom_orders (user_id, username, brand, model, budget, phone_number, details) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`;
    try {
        await pool.query(sql, [
            req.session.user.id,
            req.session.user.username,
            brand,
            model,
            budget,
            phone_number,
            details
        ]);
        res.redirect('/order-success.html');
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/stats', requireAdmin, async (req, res) => {
    try {
        const userResult = await pool.query("SELECT COUNT(*) as totalUsers FROM users");
        const totalUsers = userResult.rows[0].totalusers;

        const activeUsersMap = new Map();
        for (let data of onlineUsers.values()) {
            activeUsersMap.set(data.username, true);
        }

        res.json({
            totalUsers: parseInt(totalUsers, 10),
            onlineCount: activeUsersMap.size,
            onlineUsersList: Array.from(activeUsersMap.keys())
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/requests', requireAdmin, async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM requests WHERE status = 'pending' ORDER BY id DESC");
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/approve-request/:id', requireAdmin, async (req, res) => {
    const requestId = req.params.id;
    try {
        const reqResult = await pool.query("SELECT * FROM requests WHERE id = $1", [requestId]);
        if (reqResult.rows.length === 0) {
            return res.status(404).json({ error: "Zapros topilmadi!" });
        }
        const reqData = reqResult.rows[0];

        const sqlInsert = `INSERT INTO phones (title, brand, model, price, condition, phone_number, description, image, user_id)
                           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`;
        await pool.query(sqlInsert, [
            reqData.title,
            reqData.brand,
            reqData.model,
            reqData.price,
            reqData.condition,
            reqData.phone_number,
            reqData.description,
            reqData.image,
            reqData.user_id
        ]);

        await pool.query("UPDATE requests SET status = 'approved' WHERE id = $1", [requestId]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/reject-request/:id', requireAdmin, async (req, res) => {
    const requestId = req.params.id;
    try {
        await pool.query("UPDATE requests SET status = 'rejected' WHERE id = $1", [requestId]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`MOBILE KING V2 server running on port ${PORT}`);
});