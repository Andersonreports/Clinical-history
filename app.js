// Clinical History Tracker - Clinical OS Logic

const SYNC_URL = 'https://script.google.com/macros/s/AKfycbxXXafajUy5_1komoDIFidxrLuehfHVUUTZRlZnfeeTEI68GElYdvJGOvVI16gLPmhmZg/exec';
const LOCAL_DATA_PATH = 'data.json';
const AUTO_SYNC_INTERVAL = 30000; // 30 seconds
const TAT_REMINDER_DAYS = 10;
const EMAIL_WEBHOOK_URL = ''; // Set this to your deployed Apps Script POST endpoint if you want automatic server-side email sending.
const EMAIL_RECIPIENT = 'clinical@yourdomain.com'; // Update this address to the concerned person or team email.
const TAT_REMINDER_STORAGE_KEY = 'tatReminderEmailSent';

let state = {
    data: [],
    filteredData: [],
    searchQuery: '',
    filters: {
        month: 'all',
        test: 'all',
        status: 'all'
    },
    currentPage: 1,
    itemsPerPage: 10000, // Effectively unlimited for scrollable view
    selectedIndex: -1
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    if (typeof lucide !== 'undefined') lucide.createIcons();
    initEventListeners();
    loadData();

    // Auto-sync every 30 seconds
    setInterval(() => {
        syncData(true); // silent sync
    }, AUTO_SYNC_INTERVAL);
});

function initEventListeners() {
    const searchInput = document.getElementById('main-search');
    if (searchInput) searchInput.addEventListener('input', handleSearch);

    const testFilter = document.getElementById('test-filter');
    if (testFilter) testFilter.addEventListener('change', handleFilterChange);

    const syncBtn = document.getElementById('sync-btn');
    if (syncBtn) syncBtn.addEventListener('click', () => syncData(false));

    const autoMailBtn = document.getElementById('auto-mail-btn');
    if (autoMailBtn) {
        autoMailBtn.addEventListener('click', sendTATReminderEmails);
        if (localStorage.getItem(TAT_REMINDER_STORAGE_KEY) === 'true') {
            markAutoMailSent();
        }
    }

    const closePanel = document.getElementById('close-panel');
    const overlay = document.getElementById('panel-overlay');
    if (closePanel) closePanel.onclick = closeSidePanel;
    if (overlay) overlay.onclick = closeSidePanel;

    // Sidebar All Records Button
    const sidebarAll = document.getElementById('sidebar-all-records');
    if (sidebarAll) sidebarAll.onclick = () => restoreAllRecords();

    // Interactive Dashboard Cards (Primary Status Filters)
    const btnTotal = document.getElementById('btn-stat-total');
    const btnComplete = document.getElementById('btn-stat-complete');
    const btnPending = document.getElementById('btn-stat-pending');

    if (btnTotal) btnTotal.onclick = () => restoreAllRecords(); // Clicking Total resets EVERYTHING

    if (btnComplete) btnComplete.onclick = () => {
        updateCardActiveState('available');
        state.filters.status = 'available';
        state.currentPage = 1;
        applyFilters();
    };
    if (btnPending) btnPending.onclick = () => {
        updateCardActiveState('needed');
        state.filters.status = 'needed';
        state.currentPage = 1;
        applyFilters();
    };

    // Global Shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === '/' && document.activeElement.tagName !== 'INPUT') {
            e.preventDefault();
            if (searchInput) searchInput.focus();
        }
        if (e.key === 'Escape') closeSidePanel();
    });

    // Copy Action
    const copyBtn = document.getElementById('copy-btn');
    if (copyBtn) {
        copyBtn.addEventListener('click', () => {
            const historyEl = document.getElementById('d-history');
            if (historyEl) {
                const text = historyEl.innerText;
                navigator.clipboard.writeText(text).then(() => {
                    const originalHTML = copyBtn.innerHTML;
                    copyBtn.innerHTML = '<i data-lucide="check"></i> <span>Copied!</span>';
                    copyBtn.style.background = 'var(--success)';
                    showToast('Clinical writeup copied to clipboard');
                    if (typeof lucide !== 'undefined') lucide.createIcons();
                    setTimeout(() => {
                        copyBtn.innerHTML = originalHTML;
                        copyBtn.style.background = 'var(--primary)';
                        if (typeof lucide !== 'undefined') lucide.createIcons();
                    }, 2000);
                });
            }
        });
    }
}

// THE FIX: Universal Restore Function
function restoreAllRecords() {
    console.log('Restoring ALL records across ALL months...');
    state.filters = { month: 'all', test: 'all', status: 'all' };
    state.searchQuery = '';
    state.currentPage = 1;

    // UI Updates
    const sInput = document.getElementById('main-search');
    if (sInput) sInput.value = '';

    const tFilter = document.getElementById('test-filter');
    if (tFilter) tFilter.value = 'all';

    updateCardActiveState('all');

    // Sidebar Active State
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const sidebarAll = document.getElementById('sidebar-all-records');
    if (sidebarAll) sidebarAll.classList.add('active');

    applyFilters();
    showToast('Viewing All Records');
}

function updateCardActiveState(status) {
    document.querySelectorAll('.pro-card').forEach(c => c.classList.remove('active'));
    const badge = document.getElementById('current-filter-name');

    if (status === 'all') {
        const c = document.getElementById('btn-stat-total');
        if (c) c.classList.add('active');
        if (badge) badge.textContent = 'All Records';
    } else if (status === 'available') {
        const c = document.getElementById('btn-stat-complete');
        if (c) c.classList.add('active');
        if (badge) badge.textContent = 'History Available';
    } else if (status === 'needed') {
        const c = document.getElementById('btn-stat-pending');
        if (c) c.classList.add('active');
        if (badge) badge.textContent = 'History Required';
    }
}

async function loadData(forceRefresh = false, silent = false) {
    if (!silent) showLoading(true);
    try {
        let rawData;
        if (forceRefresh) {
            rawData = await fetchFromSyncSource();
        } else {
            try {
                const response = await fetch(LOCAL_DATA_PATH);
                if (response.ok) {
                    rawData = await response.json();
                } else {
                    throw new Error('Local data file not found');
                }
            } catch (err) {
                rawData = await fetchFromSyncSource();
            }
        }

        state.data = normalizeData(rawData).sort((a, b) => getMonthSortValue(b.month) - getMonthSortValue(a.month));

        populateSidebar();
        populateFilters();
        applyFilters();

        if (forceRefresh && !silent) showToast('Database Synced Successfully.');
    } catch (error) {
        console.error('Data Sync Error:', error);
        if (!silent) showToast('Sync Failed.', 'error');
    } finally {
        if (!silent) showLoading(false);
    }
}

async function fetchFromSyncSource() {
    if (SYNC_URL.includes('script.google.com')) {
        const response = await fetch(SYNC_URL);
        if (!response.ok) throw new Error('Apps Script unreachable');
        return await response.json();
    } else {
        return new Promise((resolve, reject) => {
            Papa.parse(SYNC_URL, {
                download: true,
                header: true,
                complete: (results) => resolve(results.data),
                error: (error) => reject(error)
            });
        });
    }
}

function normalizeMonth(m) {
    if (!m || m.toLowerCase().includes('sheet')) return 'OLD';
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const fullMonths = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
    let str = m.toString().toUpperCase().replace(/\s+/g, '');
    let foundMonth = -1;
    let foundYear = '';
    for (let i = 0; i < 12; i++) {
        if (str.includes(months[i]) || str.includes(fullMonths[i])) {
            foundMonth = i;
            break;
        }
    }
    const yearMatch = str.match(/\d{4}/);
    if (yearMatch) foundYear = yearMatch[0];
    if (foundMonth !== -1 && foundYear) return `${months[foundMonth]} ${foundYear}`;
    return m.toString().toUpperCase();
}

function getMonthSortValue(m) {
    if (m === 'OLD' || m === 'ACTIVE') return -1;
    const parts = m.split(' ');
    if (parts.length !== 2) return 0;
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const monthIdx = months.indexOf(parts[0]);
    const year = parseInt(parts[1]);
    return (year * 100) + monthIdx;
}

function getTestCategory(name, sampleName = '') {
    if (!name) return 'Other';
    const n = name.toString().toUpperCase().trim();
    const sn = sampleName.toString().toUpperCase().trim();

    // Priority checks for specific categories with custom TATs
    if (n.includes('FEMALE INFERTILITY')) return 'FEMALE INFERTILITY';
    if (n.includes('MALE INFERTILITY')) return 'MALE INFERTILITY';
    if (n.includes('AF') || n.includes('AMNIOTIC') || sn.includes(' AF') || sn.endsWith(' AF') || sn.includes('AF/')) return 'AF';

    if (n.includes('CARRIER') || n.includes('SCREENING')) return 'CARRIER SCREENING';
    if (n.includes('WES') || n.includes('EXOME') || n.includes('SEQUENCING')) return 'WES';
    if (n.includes('CMA') || n.includes('ARRAY') || n.includes('MICROARRAY')) return 'CMA';
    if (n.includes('KARYOTYPE') || n.includes('BANDING')) return 'KARYOTYPE';
    if (n.includes('NIPT') || n.includes('NIPS') || n.includes('NON INVASIVE')) return 'NIPT';
    if (n.includes('NGS') || n.includes('PANEL') || n.includes('FOCUS')) return 'GENE PANEL';
    if (n.includes('QF') || n.includes('PCR')) return 'QF-PCR';
    if (n.includes('SANGER')) return 'SANGER';
    if (n.includes('MLPA')) return 'MLPA';
    if (n.includes('FRAGILE')) return 'FRAGILE X';
    if (n.includes('SMA')) return 'SMA';
    return 'Other';
}

function calculateTAT(receivedDate, category) {
    if (!receivedDate || receivedDate === '-' || receivedDate.toString().toLowerCase() === 'nan') return '-';

    let date;
    const str = receivedDate.toString();

    // Handle ISO strings (common in Excel-to-JSON exports)
    if (str.includes('T')) {
        date = new Date(str);
        // If it's a UTC string from an Excel export, we should treat it as local date
        // But for now, new Date(str) is the safest way to get a valid date object.
    } else {
        // Parse formats: DD-MM-YYYY or DD/MM/YYYY
        const parts = str.split(/[-/]/);
        if (parts.length !== 3) return '-';

        let day = parseInt(parts[0]);
        let month = parseInt(parts[1]) - 1; // 0-indexed
        let year = parseInt(parts[2]);
        if (year < 100) year += 2000;
        date = new Date(year, month, day);
    }

    if (!date || isNaN(date.getTime())) return '-';

    let daysToAdd = 28; // Default for remaining tests
    if (category === 'FEMALE INFERTILITY' || category === 'MALE INFERTILITY') {
        daysToAdd = 15;
    } else if (category === 'AF') {
        daysToAdd = 20;
    }

    date.setDate(date.getDate() + daysToAdd);

    // Format back to DD-MM-YYYY
    const d = date.getDate().toString().padStart(2, '0');
    const m = (date.getMonth() + 1).toString().padStart(2, '0');
    const y = date.getFullYear();

    return `${d}-${m}-${y}`;
}

function normalizeData(data) {
    if (!Array.isArray(data)) return [];
    return data.filter(row => row && (row['Sample Name'] || row['Anderson ID'] || row['SAMPLE NAME'] || row['ANDERSON ID'])).map(row => {
        const sampleName = row['Sample Name'] || row['SAMPLE NAME'] || 'N/A';
        const andersonId = row['Anderson ID'] || row['ANDERSON ID'] || 'N/A';
        const testName = row['Test Name'] || row['TEST NAME'] || 'Unknown Test';
        const testCategory = getTestCategory(testName, sampleName);
        const client = row['Client'] || row['Client '] || row['CLIENT'] || '-';
        const history = row['Clinical History writeup'] || row['CLINICAL HISTORY WRITEUP'] || '';
        const month = normalizeMonth(row['Month']);

        // Aggressive header detection (strips spaces and special chars)
        const getVal = (patterns) => {
            const keys = Object.keys(row);
            const cleanPatterns = patterns.map(p => p.replace(/[^A-Z]/gi, '').toUpperCase());
            for (const key of keys) {
                const cleanKey = key.replace(/[^A-Z]/gi, '').toUpperCase();
                if (cleanPatterns.includes(cleanKey)) {
                    const val = row[key];
                    if (val !== undefined && val !== null && val.toString().trim() !== '') return val;
                }
            }
            return '-';
        };

        const receivedDateRaw = getVal(['Received Date', 'RECEIVED DATE', 'Recieved date', 'Recieved Date', 'Date Received', 'DATE']);
        let receivedDate = receivedDateRaw;

        // If it's an ISO string (from Excel/Google), format it to DD-MM-YYYY for display
        if (receivedDateRaw.toString().includes('T') || (receivedDateRaw instanceof Date)) {
            const dObj = new Date(receivedDateRaw);
            if (!isNaN(dObj.getTime())) {
                const dd = dObj.getDate().toString().padStart(2, '0');
                const mm = (dObj.getMonth() + 1).toString().padStart(2, '0');
                const yyyy = dObj.getFullYear();
                receivedDate = `${dd}-${mm}-${yyyy}`;
            }
        }

        // Auto-calculate TAT date if Received Date is present
        let tatDate = getVal(['TAT Date', 'TAT DATE', 'TAT date', 'TAT']);
        if (!tatDate || tatDate === '-' || tatDate.toString().toLowerCase() === 'nan') {
            tatDate = calculateTAT(receivedDateRaw, testCategory);
        }
        const remark = row['Remark'] || row['REMARK'] || '';
        const trfReport = row['TRF AND REPORTS'] || row['TRF AND REPORT'] || row['TRF and Reports'] || '';
        const hasHistory = trfReport && trfReport.toString().trim().length > 0 && trfReport.toString().toLowerCase() !== 'nan';

        return {
            sampleName, andersonId, testName, testCategory, client, history, trfReport, month, remark, hasHistory, receivedDate, tatDate
        };
    });
}

function populateSidebar() {
    const nav = document.getElementById('sidebar-months');
    if (!nav) return;

    // Clear existing dynamic months (keep labels and All Records)
    const labelView = nav.querySelector('.nav-label');
    const allRecords = document.getElementById('sidebar-all-records');
    nav.innerHTML = '';
    if (labelView) nav.appendChild(labelView);
    if (allRecords) nav.appendChild(allRecords);

    const rawMonths = [...new Set(state.data.map(item => item.month))].filter(Boolean);
    const sortedMonths = rawMonths.sort((a, b) => getMonthSortValue(b) - getMonthSortValue(a));

    const byMonthLabel = document.createElement('div');
    byMonthLabel.className = 'nav-label';
    byMonthLabel.textContent = 'By Month';
    nav.appendChild(byMonthLabel);

    sortedMonths.forEach(m => {
        const item = document.createElement('div');
        item.className = `nav-item ${state.filters.month === m ? 'active' : ''}`;
        item.dataset.month = m;
        item.innerHTML = `<i data-lucide="calendar"></i> <span>${m}</span>`;
        item.onclick = () => selectMonth(m, item);
        nav.appendChild(item);
    });
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function selectMonth(m, el) {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    el.classList.add('active');
    state.filters.month = m;
    state.currentPage = 1;
    applyFilters();
}

function populateFilters() {
    const categories = [...new Set(state.data.map(item => item.testCategory))].filter(Boolean).sort();
    const tSelect = document.getElementById('test-filter');
    if (tSelect) {
        const current = tSelect.value;
        tSelect.innerHTML = '<option value="all">All Test Categories</option>';
        categories.forEach(c => { tSelect.innerHTML += `<option value="${c}">${c}</option>`; });
        tSelect.value = current || 'all';
    }
}

function updateStats() {
    const total = state.filteredData.length;
    const complete = state.filteredData.filter(i => i.hasHistory).length;
    const pending = total - complete;
    const sTotal = document.getElementById('stat-total');
    const sComplete = document.getElementById('stat-complete');
    const sPending = document.getElementById('stat-pending');
    if (sTotal) sTotal.textContent = total;
    if (sComplete) sComplete.textContent = complete;
    if (sPending) sPending.textContent = pending;
}

function updateTatDueCount() {
    const dueCount = state.data.filter(item => !item.hasHistory && item.tatDate && item.tatDate !== '-' && isTatDueWithinDays(item.tatDate, TAT_REMINDER_DAYS)).length;
    const badge = document.getElementById('tat-due-count');
    if (badge) badge.textContent = `Due in ${TAT_REMINDER_DAYS} days: ${dueCount}`;
}

function handleSearch(e) {
    state.searchQuery = e.target.value.toLowerCase();
    state.currentPage = 1;
    applyFilters();
}

function handleFilterChange() {
    const tFilter = document.getElementById('test-filter');
    if (tFilter) state.filters.test = tFilter.value;
    state.currentPage = 1;
    applyFilters();
}

function applyFilters() {
    state.filteredData = state.data.filter(item => {
        const query = state.searchQuery;
        const matchesSearch =
            item.sampleName.toLowerCase().includes(query) ||
            item.andersonId.toString().toLowerCase().includes(query) ||
            item.testName.toLowerCase().includes(query) ||
            item.client.toLowerCase().includes(query);
        const matchesMonth = state.filters.month === 'all' || item.month === state.filters.month;
        const matchesTest = state.filters.test === 'all' || item.testCategory === state.filters.test;
        let matchesStatus = true;
        if (state.filters.status === 'available') matchesStatus = item.hasHistory;
        if (state.filters.status === 'needed') matchesStatus = !item.hasHistory;
        return matchesSearch && matchesMonth && matchesTest && matchesStatus;
    });
    renderGrid();
    updateStats();
    updateTatDueCount();
}

function renderGrid() {
    const body = document.getElementById('grid-body');
    if (!body) return;

    const totalPages = Math.ceil(state.filteredData.length / state.itemsPerPage);
    if (state.currentPage > totalPages && totalPages > 0) {
        state.currentPage = totalPages;
    }

    body.innerHTML = '';
    const pageData = state.filteredData;
    if (pageData.length === 0) {
        body.innerHTML = `<tr><td colspan="7" style="padding: 100px; text-align:center; color: var(--text-dim);">
            <i data-lucide="inbox" style="width:40px; height:40px; opacity:0.1; margin-bottom:10px;"></i>
            <p style="font-weight:600;">No cases found in this view</p>
        </td></tr>`;
        if (typeof lucide !== 'undefined') lucide.createIcons();
        return;
    }
    pageData.forEach((item, index) => {
        const absoluteIndex = index;
        const tr = document.createElement('tr');
        tr.onclick = () => openSidePanel(absoluteIndex);
        tr.innerHTML = `
            <td>
                <div class="identity-cell">
                    <span class="name">${item.sampleName}</span>
                    <span class="sub">${item.client.substring(0, 50)}</span>
                </div>
            </td>
            <td><code class="token-id">${item.andersonId}</code></td>
            <td>
                <div style="display:flex; flex-direction:column; gap:4px;">
                    <span class="type-badge">${item.testCategory}</span>
                    <span style="font-size:11px; color:var(--text-dim); max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${item.testName}</span>
                </div>
            </td>
            <td style="font-weight:600; font-size:12px; white-space:nowrap; min-width:110px;">${item.receivedDate}</td>
            <td style="font-weight:600; font-size:12px; white-space:nowrap; min-width:110px;">${item.tatDate}</td>
            <td>
                <div class="status-dot-badge">
                    <div class="dot ${item.hasHistory ? 'ok' : 'missing'}"></div>
                    <span>${item.hasHistory ? 'Completed' : 'Action Required'}</span>
                </div>
            </td>
            <td style="text-align:right;">
                <button class="btn-sync-compact" style="padding: 4px 10px; font-size:10px;">DETAILS</button>
            </td>
        `;
        body.appendChild(tr);
    });
    const infoEl = document.getElementById('pagination-info');
    if (infoEl) infoEl.textContent = `Displaying ${state.filteredData.length} records`;
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function renderPagination(totalItems) {
    const totalPages = Math.ceil(totalItems / state.itemsPerPage);
    const container = document.getElementById('pagination');
    if (!container) return;
    container.innerHTML = '';
    if (totalPages <= 1) return;
    const createBtn = (content, page, active = false, disabled = false) => {
        const btn = document.createElement('button');
        btn.className = `page-btn ${active ? 'active' : ''}`;
        btn.innerHTML = content;
        btn.disabled = disabled;
        btn.onclick = (e) => {
            e.stopPropagation();
            if (!disabled) { state.currentPage = page; renderGrid(); }
        };
        return btn;
    };
    container.appendChild(createBtn('&laquo;', state.currentPage - 1, false, state.currentPage === 1));
    let start = Math.max(1, state.currentPage - 1);
    let end = Math.min(totalPages, start + 2);
    if (end - start < 2) start = Math.max(1, end - 2);
    for (let i = start; i <= end; i++) {
        container.appendChild(createBtn(i, i, i === state.currentPage));
    }
    container.appendChild(createBtn('&raquo;', state.currentPage + 1, false, state.currentPage === totalPages));
}

function openSidePanel(index) {
    const item = state.filteredData[index];
    if (!item) return;
    document.getElementById('d-name').textContent = item.sampleName;
    document.getElementById('d-id').textContent = item.andersonId;
    document.getElementById('d-test').textContent = item.testName;
    document.getElementById('d-month').textContent = item.month;
    const dRec = document.getElementById('d-received');
    if (dRec) dRec.textContent = item.receivedDate;
    const dTat = document.getElementById('d-tat');
    if (dTat) dTat.textContent = item.tatDate;
    document.getElementById('d-client').textContent = item.client;
    document.getElementById('d-trf').textContent = item.trfReport || 'No TRF information found.';
    document.getElementById('d-history').textContent = item.history || 'NO CLINICAL WRITEUP PROVIDED';
    document.getElementById('d-remark').textContent = item.remark || 'No specific registry remarks.';
    document.getElementById('side-panel').classList.add('open');
    document.getElementById('panel-overlay').classList.add('active');
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function closeSidePanel() {
    document.getElementById('side-panel').classList.remove('open');
    document.getElementById('panel-overlay').classList.remove('active');
}

function showLoading(show) {
    const btn = document.getElementById('sync-btn');
    if (btn) {
        if (show) {
            btn.innerHTML = '<i data-lucide="loader-2" class="spin"></i> <span>Syncing...</span>';
            btn.disabled = true;
        } else {
            btn.innerHTML = '<i data-lucide="refresh-cw"></i> <span>Refresh Data</span>';
            btn.disabled = false;
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }
    }
}

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    if (toast) {
        toast.textContent = message;
        toast.style.borderLeft = `5px solid ${type === 'error' ? 'var(--danger)' : 'var(--success)'}`;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 3000);
    }
}

function parseDateString(value) {
    if (!value) return null;
    if (value instanceof Date) return value;
    const str = value.toString().trim();
    if (!str) return null;
    let date = null;
    if (str.includes('T')) {
        date = new Date(str);
    } else if (/\d{1,2}[-/]\d{1,2}[-/]\d{2,4}/.test(str)) {
        const parts = str.split(/[-/]/).map(p => p.trim());
        const day = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1;
        let year = parseInt(parts[2], 10);
        if (year < 100) year += 2000;
        date = new Date(year, month, day);
    } else {
        date = new Date(str);
    }
    return date && !isNaN(date.getTime()) ? date : null;
}

function isTatDueWithinDays(tatDate, days) {
    const date = parseDateString(tatDate);
    if (!date) return false;
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    date.setHours(0, 0, 0, 0);
    const diff = Math.ceil((date - now) / (1000 * 60 * 60 * 24));
    return diff >= 0 && diff <= days;
}

function buildReminderBody(records) {
    const total = records.length;
    const lines = [
        'Dear Concerned Person,',
        '',
        `The following ${total} sample${total === 1 ? '' : 's'} have TAT due within ${TAT_REMINDER_DAYS} days and require clinical history details:`,
        ''
    ];

    records.slice(0, 15).forEach(item => {
        lines.push(`• ${item.sampleName} | ${item.andersonId} | ${item.testName} | Received: ${item.receivedDate} | TAT: ${item.tatDate}`);
    });

    if (total > 15) {
        lines.push('', `...and ${total - 15} more records.`);
    }

    lines.push('', 'Please share the clinical history details for these samples as soon as possible.', '', 'Thank you,', 'Clinical History Tracker');
    return lines.join('\n');
}

async function sendAutomatedMail(records) {
    const emailBody = buildReminderBody(records);
    const subject = 'Clinical History Request - TAT due in 10 days';

    if (EMAIL_WEBHOOK_URL) {
        try {
            const response = await fetch(EMAIL_WEBHOOK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    recipient: EMAIL_RECIPIENT,
                    subject,
                    requestNote: 'Please provide clinical history details for the listed samples.',
                    records: records.map(item => ({
                        sampleName: item.sampleName,
                        andersonId: item.andersonId,
                        testName: item.testName,
                        client: item.client,
                        receivedDate: item.receivedDate,
                        tatDate: item.tatDate,
                        month: item.month
                    }))
                })
            });
            if (!response.ok) throw new Error('Mail service returned error');
            const data = await response.json();
            if (data.success) {
                return true;
            }
            throw new Error(data.error || 'Mail service returned failure');
        } catch (err) {
            console.error('Automated mail failed', err);
            showToast('Automatic mail service failed. Opening email composer instead.', 'error');
        }
    }

    const mailto = `mailto:${encodeURIComponent(EMAIL_RECIPIENT)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(emailBody)}`;
    window.location.href = mailto;
    return true;
}

function markAutoMailSent() {
    const autoMailBtn = document.getElementById('auto-mail-btn');
    if (autoMailBtn) {
        autoMailBtn.classList.add('sent');
        autoMailBtn.disabled = true;
        const text = document.getElementById('auto-mail-text');
        if (text) text.textContent = 'TAT Reminder Sent';
    }
    localStorage.setItem(TAT_REMINDER_STORAGE_KEY, 'true');
}

async function sendTATReminderEmails() {
    const dueRecords = state.data.filter(item => !item.hasHistory && item.tatDate && item.tatDate !== '-' && isTatDueWithinDays(item.tatDate, TAT_REMINDER_DAYS));
    if (dueRecords.length === 0) {
        showToast(`No records found with TAT due within ${TAT_REMINDER_DAYS} days.`);
        return;
    }

    const success = await sendAutomatedMail(dueRecords);
    if (success) {
        markAutoMailSent();
        showToast('TAT reminder email request prepared and sent.');
    }
}

async function syncData(silent = false) {
    await loadData(true, silent);
}
