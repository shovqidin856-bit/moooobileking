<!DOCTYPE html>
<html lang="uz">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Admin Panel - Zaproslar va Statistika</title>
    <link rel="stylesheet" href="style.css">
    <style>
        .stats-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 12px;
            margin-bottom: 20px;
        }
        .stat-card {
            background: #1e293b;
            border: 1px solid #334155;
            padding: 16px;
            border-radius: 12px;
            text-align: center;
        }
        .stat-number {
            font-size: 24px;
            font-weight: 800;
            color: #38bdf8;
            margin-top: 5px;
        }
        .online-dot {
            height: 10px;
            width: 10px;
            background-color: #22c55e;
            border-radius: 50%;
            display: inline-block;
            box-shadow: 0 0 8px #22c55e;
            margin-right: 6px;
        }
    </style>
</head>
<body>

    <header>
        <a href="index.html" class="back-btn">❮</a>
        <h1>⚡ ADMIN PANEL</h1>
    </header>

    <div class="container">
        <div class="page-title">STATISTIKA VA ZAPROSLAR</div>

        <!-- Statistika bloki -->
        <div class="stats-grid">
            <div class="stat-card">
                <div style="font-size: 13px; color: #94a3b8;">Jami Ro'yxatdan o'tganlar</div>
                <div id="total-users" class="stat-number">...</div>
            </div>
            <div class="stat-card">
                <div style="font-size: 13px; color: #94a3b8;"><span class="online-dot"></span>Hozir Onlayn</div>
                <div id="online-users" class="stat-number" style="color: #4ade80;">...</div>
            </div>
        </div>

        <div style="font-size: 16px; font-weight: bold; margin-bottom: 15px; color: #f8fafc;">KELIB TUSHGAN ZAPROSLAR</div>
        <div id="requests-list"></div>
    </div>

    <script>
        function loadStats() {
            fetch('/api/admin/stats')
                .then(res => res.json())
                .then(data => {
                    if(data.totalUsers !== undefined) {
                        document.getElementById('total-users').innerText = data.totalUsers;
                        document.getElementById('online-users').innerText = data.onlineCount;
                    }
                }).catch(e => console.log(e));
        }

        function loadRequests() {
            fetch('/api/admin/requests')
                .then(res => {
                    if(res.status === 403) {
                        alert("Siz admin emassiz!");
                        window.location.href = 'index.html';
                        return [];
                    }
                    return res.json();
                })
                .then(data => {
                    const list = document.getElementById('requests-list');
                    if(!data || data.length === 0) {
                        list.innerHTML = '<p style="text-align:center; color:#94a3b8; margin-top:20px;">Yangi zaproslar yo\'q.</p>';
                        return;
                    }

                    list.innerHTML = data.map(req => `
                        <div class="phone-card">
                            <img src="${req.image}" alt="${req.title}">
                            <div class="phone-info">
                                <div class="phone-title">${req.title}</div>
                                <div class="phone-price">${req.price}</div>
                                <div class="phone-meta">👤 <b>Yuboruvchi (User):</b> ${req.username}</div>
                                <div class="phone-meta">📱 <b>Brend/Model:</b> ${req.brand} (${req.model})</div>
                                <div class="phone-meta">✨ <b>Holat:</b> ${req.condition}</div>
                                <div class="phone-meta">📞 <b>Tel:</b> ${req.phone_number}</div>
                                <div class="phone-meta">📝 <b>Tavsif:</b> ${req.description}</div>
                                
                                <div class="action-row">
                                    <button onclick="approveRequest(${req.id})" class="approve-btn">✅ TASDIQLASH</button>
                                    <button onclick="rejectRequest(${req.id})" class="reject-btn">❌ BEKOR QILISH</button>
                                </div>
                            </div>
                        </div>
                    `).join('');
                });
        }

        function approveRequest(id) {
            fetch('/api/admin/approve-request/' + id, { method: 'POST' })
                .then(res => res.json())
                .then(data => {
                    if(data.success) {
                        alert("E'lon saytga chiqarildi!");
                        loadRequests();
                        loadStats();
                    }
                });
        }

        function rejectRequest(id) {
            fetch('/api/admin/reject-request/' + id, { method: 'POST' })
                .then(res => res.json())
                .then(data => {
                    if(data.success) {
                        alert("Zapros rad etildi!");
                        loadRequests();
                        loadStats();
                    }
                });
        }

        loadStats();
        loadRequests();

        // Har 10 sekundda statistikani yangilab turish
        setInterval(loadStats, 10000);
    </script>
</body>
</html>