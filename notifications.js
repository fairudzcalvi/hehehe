// Notifications modal — pulls live data from /api/notifications (SQLite via server.js)

const modal    = document.getElementById('notifications-modal');
const viewBtn  = document.getElementById('view-notifications');
const closeBtn = document.getElementById('close-modal');
const filterType   = document.getElementById('filter-type');
const filterStatus = document.getElementById('filter-status');
const totalCount   = document.getElementById('total-count');
const todayCount   = document.getElementById('today-count');
const listEl       = document.getElementById('notifications-list');

let notificationsData = [];

// --- Fetch from DB ---
async function loadNotifications() {
    try {
        const res = await fetch('/api/notifications');
        notificationsData = await res.json();
        updateSummaryCard();
    } catch {
        notificationsData = [];
    }
}

// --- Update the card on the dashboard ---
function updateSummaryCard() {
    const today = new Date().toISOString().split('T')[0];
    const todayItems = notificationsData.filter(n => n.timestamp.startsWith(today));

    document.getElementById('sms-count').textContent = todayItems.length;

    if (notificationsData.length > 0) {
        const last = notificationsData[0];
        document.getElementById('last-sms').textContent =
            new Date(last.timestamp).toLocaleTimeString();
    }
}

// --- Helpers ---
function getTypeIcon(type) {
    const icons = { 'Low Alert': '⚠️', 'Full Alert': '🔔', 'Info': 'ℹ️', 'System': '⚙️' };
    return icons[type] || '📧';
}

function getTypeClass(type) {
    return type.toLowerCase().replace(' ', '-');
}

function formatDate(timestamp) {
    const date = new Date(timestamp);
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    const dateStr = date.toISOString().split('T')[0];
    const time = date.toLocaleTimeString();

    if (dateStr === today) return `Today at ${time}`;
    if (dateStr === yesterday) return `Yesterday at ${time}`;
    return date.toLocaleString();
}

// --- Render list ---
function renderNotifications(data) {
    listEl.innerHTML = '';

    if (data.length === 0) {
        listEl.innerHTML = '<div class="no-notifications">No notifications found</div>';
        return;
    }

    data.forEach(n => {
        const card = document.createElement('div');
        card.className = `notification-card ${getTypeClass(n.type)} status-${n.status.toLowerCase()}`;
        card.innerHTML = `
            <div class="notification-icon">${getTypeIcon(n.type)}</div>
            <div class="notification-content">
                <div class="notification-header">
                    <span class="notification-type">${n.type}</span>
                    <span class="notification-time">${formatDate(n.timestamp)}</span>
                </div>
                <div class="notification-message">${n.message}</div>
                <div class="notification-footer">
                    <span class="notification-recipient">📱 ${n.recipient}</span>
                    <span class="notification-status status-${n.status.toLowerCase()}">${n.status}</span>
                </div>
            </div>
        `;
        listEl.appendChild(card);
    });
}

// --- Filter ---
function applyFilters() {
    const type   = filterType.value;
    const status = filterStatus.value;

    let filtered = notificationsData;
    if (type   !== 'all') filtered = filtered.filter(n => n.type === type);
    if (status !== 'all') filtered = filtered.filter(n => n.status === status);

    renderNotifications(filtered);

    totalCount.textContent = filtered.length;
    const today = new Date().toISOString().split('T')[0];
    todayCount.textContent = filtered.filter(n => n.timestamp.startsWith(today)).length;
}

// --- Open modal ---
viewBtn.addEventListener('click', async () => {
    await loadNotifications();
    applyFilters();
    modal.style.display = 'block';
});

// --- Close modal ---
closeBtn.addEventListener('click', () => modal.style.display = 'none');
window.addEventListener('click', e => { if (e.target === modal) modal.style.display = 'none'; });

// --- Filter listeners ---
filterType.addEventListener('change', applyFilters);
filterStatus.addEventListener('change', applyFilters);

// --- Init ---
loadNotifications();
