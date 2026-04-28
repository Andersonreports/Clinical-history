// Clinical History Tracker - Clinical OS Logic

const SYNC_URL = 'https://script.google.com/macros/s/AKfycby0MbYrBhtFov8Kda1wqsQu6YNgwPeKliaLW-oCqehCostpJpqyhQltY1yNGoXddh2zqw/exec';
const LOCAL_DATA_PATH = 'data.json';
const AUTO_SYNC_INTERVAL = 30000; // 30 seconds
const TAT_REMINDER_DAYS = 10;
const EMAIL_WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycby0MbYrBhtFov8Kda1wqsQu6YNgwPeKliaLW-oCqehCostpJpqyhQltY1yNGoXddh2zqw/exec';
const EMAIL_RECIPIENT = 'jeevav936@gmail.com';

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

    if (btnTotal) btnTotal.onclick = () => {
        updateCardActiveState('all');
        state.filters.status = 'all';
        state.currentPage = 1;
        applyFilters();
    };

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

const CACHE_KEY = 'clinicalDataCache';

function applyRawData(rawData) {
    state.data = normalizeData(rawData)
        .filter(item => {
            const parts = item.month.split(' ');
            return parts.length === 2 && parseInt(parts[1]) >= 2026;
        })
        .sort((a, b) => getMonthSortValue(b.month) - getMonthSortValue(a.month));
    populateSidebar();
    populateFilters();
    applyFilters();
}

async function loadData(forceRefresh = false, silent = false) {
    // Show cached data instantly if available
    if (!forceRefresh) {
        try {
            const cached = localStorage.getItem(CACHE_KEY);
            if (cached) {
                applyRawData(JSON.parse(cached));
            }
        } catch (e) {}
    }

    if (!silent) showLoading(true);
    try {
        const rawData = await fetchFromSyncSource();
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(rawData)); } catch (e) {}
        applyRawData(rawData);
        if (!silent) showToast('Database Synced Successfully.');
    } catch (error) {
        console.error('Data Sync Error:', error);
        if (!silent) showToast(`Sync Failed: ${error.message}`, 'error');
    } finally {
        if (!silent) showLoading(false);
    }
}

async function fetchFromSyncSource() {
    if (SYNC_URL.includes('script.google.com')) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout
        try {
            const response = await fetch(SYNC_URL, { signal: controller.signal });
            clearTimeout(timeout);
            if (!response.ok) throw new Error(`Apps Script returned HTTP ${response.status}`);
            const text = await response.text();
            try {
                return JSON.parse(text);
            } catch (e) {
                console.error('Non-JSON response from Apps Script:', text.substring(0, 300));
                throw new Error('Apps Script returned non-JSON — check deployment access settings');
            }
        } catch (e) {
            clearTimeout(timeout);
            if (e.name === 'AbortError') throw new Error('Sync timed out after 30s — Apps Script may be slow');
            throw e;
        }
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

    // CM SCHEME - WHOLE EXOME SEQUENCING (CM-WES, CM SCHEME, CM WHOLE EXOME, etc.)
    if (n.includes('CM') && (n.includes('SCHEME') || n.includes('WES') || n.includes('EXOME')))
        return 'CM SCHEME - WHOLE EXOME SEQUENCING';

    // ADVAT FOCUS CARRIER SCREENING
    if (n.includes('ADVAT')) return 'ADVAT FOCUS CARRIER SCREENING';

    // COUPLE CARRIER SCREENING BY CLINICAL EXOME SEQUENCING (before clinical exome check)
    if (n.includes('COUPLE') && n.includes('CARRIER'))
        return 'COUPLE CARRIER SCREENING BY CLINICAL EXOME SEQUENCING';

    // COMPREHENSIVE CARRIER SCREENING (before general carrier checks)
    if (n.includes('COMPREHENSIVE') && n.includes('CARRIER'))
        return 'COMPREHENSIVE CARRIER SCREENING';

    // FEMALE INFERTILITY (includes WES/Female Infertility combos)
    if (n.includes('FEMALE INFERTILITY') || n.includes('FEMALE INFERT'))
        return 'FEMALE INFERTILITY';

    // MALE INFERTILITY (includes WES/Male Infertility combos)
    if (n.includes('MALE INFERTILITY') || n.includes('MALE INFERT'))
        return 'MALE INFERTILITY';

    // CLINICAL EXOME SEQUENCING (CES shorthand, clinical exome)
    if (n === 'CES' || n.includes('CLINICAL EXOME'))
        return 'CLINICAL EXOME SEQUENCING';

    // AF (Amniotic Fluid) — detected by test name or sample name markers; preserves 20-day TAT
    if (n.includes('AMNIOTIC') || sn.includes(' AF') || sn.endsWith(' AF') || sn.includes('AF/') || sn.startsWith('AF '))
        return 'AF';

    // MITOCHONDRIAL DNA SEQUENCING BY NGS (standalone only — not part of WES/CES combos)
    if (n.includes('MITOCHONDRIAL') && !n.includes('WHOLE EXOME') && !n.includes('WES') && !n.includes('CLINICAL EXOME'))
        return 'MITOCHONDRIAL DNA SEQUENCING BY NGS';

    // NGS DATA REANALYSIS
    if (n.includes('REANALYSIS') || n.includes('RE-ANALYSIS') || n.includes('RE ANALYSIS'))
        return 'NGS DATA REANALYSIS';

    // WHOLE GENOME SEQUENCING (before WES to avoid false match on WHOLE)
    if (n.includes('WGS') || n.includes('WHOLE GENOME'))
        return 'WHOLE GENOME SEQUENCING (WGS)';

    // WHOLE EXOME SEQUENCING (WES)
    if (n.includes('WES') || n.includes('WHOLE EXOME') || n.includes('EXOME'))
        return 'WHOLE EXOME SEQUENCING (WES)';

    // GENE PANEL (panels, hereditary, single-gene sequencing, etc.)
    if (n.includes('PANEL') || n.includes('HEREDITARY') || n.includes('HCGP') ||
        n.includes('SINGLE GENE') || n.includes('SINGLE FULL GENE') ||
        n.includes('GENE SEQUENCING') || n.includes('MUTATION ANALYSIS') || n.includes('MODY'))
        return 'GENE PANEL';

    return 'Other Tests';
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
        const hasHistory = history && history.toString().trim().length > 0 && history.toString().toLowerCase() !== 'nan';
        const emailSentRaw = getVal(['Email Sent', 'EMAIL SENT', 'Email sent']);
        const emailSent = (emailSentRaw && emailSentRaw !== '-') ? emailSentRaw.toString().trim() : '';

        return {
            sampleName, andersonId, testName, testCategory, client, history, trfReport, month, remark, hasHistory, receivedDate, tatDate, emailSent
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
    // Close sidebar on mobile after selection
    if (window.innerWidth <= 768) toggleSidebar();
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
    // Always reflect month + test + search — never affected by status card clicks
    const base = state.data.filter(item => {
        const q = state.searchQuery;
        const matchesSearch = !q ||
            item.sampleName.toLowerCase().includes(q) ||
            item.andersonId.toString().toLowerCase().includes(q) ||
            item.testName.toLowerCase().includes(q) ||
            item.client.toLowerCase().includes(q);
        const matchesMonth = state.filters.month === 'all' || item.month === state.filters.month;
        const matchesTest  = state.filters.test  === 'all' || item.testCategory === state.filters.test;
        return matchesSearch && matchesMonth && matchesTest;
    });
    const total    = base.length;
    const complete = base.filter(i => i.hasHistory).length;
    const pending  = total - complete;
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
            <td style="text-align:right; white-space:nowrap;">
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

function updatePanelMailButton(item, index) {
    const btn = document.getElementById('panel-mail-btn');
    const textEl = document.getElementById('panel-mail-text');
    if (!btn || !textEl) return;

    if (item.hasHistory) {
        btn.style.display = 'none';
        return;
    }

    btn.style.display = '';
    btn.className = 'btn-panel-mail';
    btn.disabled = false;
    btn.onclick = (e) => { e.stopPropagation(); sendSampleReminder(index, btn, textEl); };

    const es = getEmailSentState(item);
    if (!es.sent) {
        btn.innerHTML = '<i data-lucide="send"></i><span>Send Reminder</span>';
    } else if (es.resend) {
        btn.classList.add('resend');
        const label = es.date ? `Resend · ${formatSentDate(es.date)}` : 'Resend';
        btn.innerHTML = `<i data-lucide="send"></i><span>${label}</span>`;
    } else {
        btn.classList.add('sent');
        btn.disabled = true;
        const label = es.date ? `Sent ${formatSentDate(es.date)}` : 'Sent';
        btn.innerHTML = `<i data-lucide="check"></i><span>${label}</span>`;
    }
    if (typeof lucide !== 'undefined') lucide.createIcons();
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
    updatePanelMailButton(item, index);
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

function formatSentDate(date) {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const d = date.getDate();
    const m = months[date.getMonth()];
    const y = date.getFullYear();
    return new Date().getFullYear() === y ? `${d} ${m}` : `${d} ${m} ${y}`;
}

function getEmailSentState(item) {
    // Gather candidates: sheet column + localStorage (manual sends)
    const sheetVal   = item.emailSent && item.emailSent !== '' ? item.emailSent : null;
    const localVal   = localStorage.getItem(`emailSentDate_${item.andersonId}`);

    // Legacy "Yes" with no date — treat as sent but no date
    if (sheetVal === 'Yes' && !localVal) return { sent: true, date: null, resend: false };

    // Pick the most recent valid date from either source
    const sheetDate  = sheetVal && sheetVal !== 'Yes' ? parseDateString(sheetVal) : null;
    const localDate  = localVal ? parseDateString(localVal) : null;

    let sentDate = null;
    if (sheetDate && localDate) sentDate = sheetDate >= localDate ? sheetDate : localDate;
    else sentDate = sheetDate || localDate;

    if (!sentDate) return { sent: false };

    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const d = new Date(sentDate);
    d.setHours(0, 0, 0, 0);
    const daysSince = Math.floor((now - d) / (1000 * 60 * 60 * 24));
    return { sent: true, date: sentDate, daysSince, resend: daysSince >= 7 };
}

function buildMailButton(item, index) {
    const es = getEmailSentState(item);
    if (!es.sent) {
        return `<button class="btn-send-mail" onclick="event.stopPropagation(); sendSampleReminder(${index}, this)"><i data-lucide="send"></i>Mail</button>`;
    }
    if (es.resend) {
        const label = es.date ? `Resend · ${formatSentDate(es.date)}` : 'Resend';
        return `<button class="btn-send-mail resend" onclick="event.stopPropagation(); sendSampleReminder(${index}, this)"><i data-lucide="send"></i>${label}</button>`;
    }
    const label = es.date ? `Sent ${formatSentDate(es.date)}` : 'Sent';
    return `<button class="btn-send-mail sent" disabled><i data-lucide="check"></i>${label}</button>`;
}

function getTodayDateStr() {
    const t = new Date();
    const dd = t.getDate().toString().padStart(2, '0');
    const mm = (t.getMonth() + 1).toString().padStart(2, '0');
    return `${dd}-${mm}-${t.getFullYear()}`;
}

function clearStaleEmailLocalStorage() {
    Object.keys(localStorage)
        .filter(k => k.startsWith('emailSent_') || k.startsWith('emailSentDate_'))
        .forEach(k => localStorage.removeItem(k));
}

function markButtonSent(btnEl, dateStr) {
    const date = parseDateString(dateStr);
    const label = date ? `Sent ${formatSentDate(date)}` : 'Sent';
    btnEl.classList.remove('resend');
    btnEl.classList.add('sent');
    btnEl.disabled = true;
    btnEl.innerHTML = `<i data-lucide="check"></i><span>${label}</span>`;
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

async function sendSampleReminder(index, btnEl) {
    const item = state.filteredData[index];
    if (!item) return;
    const dateKey = `emailSentDate_${item.andersonId}`;
    const todayStr = getTodayDateStr();

    btnEl.disabled = true;
    btnEl.innerHTML = '<i data-lucide="loader-2" class="spin"></i>';
    if (typeof lucide !== 'undefined') lucide.createIcons();

    if (EMAIL_WEBHOOK_URL) {
        try {
            const params = new URLSearchParams({
                action: 'sendReminder',
                andersonId: item.andersonId,
                sampleName: item.sampleName,
                client: item.client,
                testName: item.testName,
                receivedDate: item.receivedDate,
                tatDate: item.tatDate
            });
            const response = await fetch(`${EMAIL_WEBHOOK_URL}?${params}`);
            if (!response.ok) throw new Error('Mail service error');
            const data = await response.json();
            if (data.success) {
                item.emailSent = todayStr;
                localStorage.setItem(`emailSentDate_${item.andersonId}`, todayStr);
                markButtonSent(btnEl, todayStr);
                showToast(`Reminder sent for ${item.andersonId}`);
                return;
            }
            throw new Error(data.error || 'Service failed');
        } catch (err) {
            console.error('Send reminder failed', err);
            btnEl.disabled = false;
            btnEl.innerHTML = '<i data-lucide="send"></i><span>Send Reminder</span>';
            if (typeof lucide !== 'undefined') lucide.createIcons();
            showToast(`Mail failed: ${err.message}`, 'error');
        }
    }

    // Fallback: open Gmail compose in a new tab (pre-filled with table format)
    const subject = `Action Required: Clinical History Missing for Anderson ID ${item.andersonId}`;
    const sep = '─'.repeat(60);
    const body = [
        'Dear Team,',
        '',
        `This is a reminder that the following sample has NO Clinical History recorded.`,
        '',
        sep,
        `  Anderson ID   : ${item.andersonId}`,
        `  Sample Name   : ${item.sampleName}`,
        `  Client        : ${item.client}`,
        `  Test          : ${item.testName}`,
        `  Received Date : ${item.receivedDate}`,
        `  TAT Date      : ${item.tatDate}`,
        sep,
        '',
        'Kindly provide the Clinical History details at the earliest to avoid',
        'any delay in processing and releasing the report on time.',
        '',
        'Thank you,',
        'Anderson Lab Reporting System'
    ].join('\n');
    const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(EMAIL_RECIPIENT)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.open(gmailUrl, '_blank');
    // Mark as sent so button persists across refreshes and prevents duplicates
    item.emailSent = todayStr;
    localStorage.setItem(`emailSentDate_${item.andersonId}`, todayStr);
    markButtonSent(btnEl, todayStr);
    showToast('Gmail opened — marked as sent to prevent duplicates.');
}

// ── TAT Due Modal ──────────────────────────────────────────
function getTATDueItems() {
    return state.data.filter(item =>
        !item.hasHistory &&
        item.tatDate && item.tatDate !== '-' &&
        isTatDueWithinDays(item.tatDate, TAT_REMINDER_DAYS)
    );
}

function openTATModal() {
    const items = getTATDueItems();
    const overlay = document.getElementById('tat-modal-overlay');
    const tbody = document.getElementById('tat-modal-rows');
    const subtitle = document.getElementById('modal-subtitle');
    if (!overlay || !tbody) return;

    subtitle.textContent = `${items.length} sample${items.length !== 1 ? 's' : ''} need clinical history`;
    tbody.innerHTML = '';

    if (items.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="padding:40px; text-align:center; color:var(--text-dim); font-weight:600;">No samples due within ${TAT_REMINDER_DAYS} days</td></tr>`;
    } else {
        items.forEach((item, i) => {
            const es = getEmailSentState(item);
            let actionBtn;
            if (!es.sent) {
                actionBtn = `<button class="btn-modal-send" id="ms-${i}" onclick="sendModalReminder(${i}, this)"><i data-lucide="send"></i>Send</button>`;
            } else if (es.resend) {
                const lbl = es.date ? `Resend · ${formatSentDate(es.date)}` : 'Resend';
                actionBtn = `<button class="btn-modal-send resend" id="ms-${i}" onclick="sendModalReminder(${i}, this)"><i data-lucide="send"></i>${lbl}</button>`;
            } else {
                const lbl = es.date ? `Sent ${formatSentDate(es.date)}` : 'Sent';
                actionBtn = `<button class="btn-modal-send sent" id="ms-${i}" disabled><i data-lucide="check"></i>${lbl}</button>`;
            }
            const tr = document.createElement('tr');
            tr.dataset.index = i;
            tr.innerHTML = `
                <td style="font-weight:700;">${item.sampleName}</td>
                <td><code class="token-id" style="font-size:11px;">${item.andersonId}</code></td>
                <td style="font-size:12px; color:var(--text-dim);">${item.testCategory}</td>
                <td style="font-weight:700; color:#b35a00;">${item.tatDate}</td>
                <td>${actionBtn}</td>
            `;
            tbody.appendChild(tr);
        });
    }

    // Reset send-all button
    const btn = document.getElementById('send-all-btn');
    const btnText = document.getElementById('send-all-text');
    if (btn) { btn.disabled = false; btn.className = 'btn-send-all'; }
    if (btnText) btnText.textContent = 'Send Reminder to All';

    const searchInput = document.getElementById('tat-modal-search');
    if (searchInput) searchInput.value = '';

    overlay.classList.add('open');
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

async function sendModalReminder(i, btn) {
    const items = getTATDueItems();
    const item = items[i];
    if (!item) return;

    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader-2" class="spin"></i>';
    if (typeof lucide !== 'undefined') lucide.createIcons();

    const result = await sendReminderForItem(item);

    const d = getTodayDateStr();
    if (result.success) {
        item.emailSent = d;
        localStorage.setItem(`emailSentDate_${item.andersonId}`, d);
        btn.className = 'btn-modal-send sent';
        btn.innerHTML = '<i data-lucide="check"></i>Sent';
    } else {
        // Webhook failed — open Gmail compose and still mark as sent
        const subject = `Action Required: Clinical History Missing for Anderson ID ${item.andersonId}`;
        const body = `Dear Team,\n\nAnderson ID: ${item.andersonId}\nSample: ${item.sampleName}\nClient: ${item.client}\nTest: ${item.testName}\nReceived: ${item.receivedDate}\nTAT: ${item.tatDate}\n\nPlease provide clinical history at the earliest.\n\nThank you,\nAnderson Lab`;
        window.open(`https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(EMAIL_RECIPIENT)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, '_blank');
        item.emailSent = d;
        localStorage.setItem(`emailSentDate_${item.andersonId}`, d);
        btn.className = 'btn-modal-send sent';
        btn.innerHTML = '<i data-lucide="check"></i>Sent';
        showToast('Gmail opened — marked as sent.');
    }
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function filterTATModal(query) {
    const q = query.toLowerCase();
    document.querySelectorAll('#tat-modal-rows tr').forEach(tr => {
        const text = tr.textContent.toLowerCase();
        tr.style.display = text.includes(q) ? '' : 'none';
    });
}

function closeTATModal(e) {
    if (e && e.target !== document.getElementById('tat-modal-overlay')) return;
    document.getElementById('tat-modal-overlay').classList.remove('open');
}

async function sendReminderForItem(item) {
    if (!EMAIL_WEBHOOK_URL) return { success: false, error: 'No webhook URL configured' };
    try {
        const params = new URLSearchParams({
            action: 'sendReminder',
            andersonId: item.andersonId,
            sampleName: item.sampleName,
            client: item.client,
            testName: item.testName,
            receivedDate: item.receivedDate,
            tatDate: item.tatDate
        });
        const response = await fetch(`${EMAIL_WEBHOOK_URL}?${params}`);
        if (!response.ok) return { success: false, error: `HTTP ${response.status}` };
        const data = await response.json();
        return data.success ? { success: true } : { success: false, error: data.error || 'Failed' };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function sendAllTATReminders(btn) {
    const items = getTATDueItems();
    if (items.length === 0) return;

    btn.disabled = true;
    const btnText = document.getElementById('send-all-text');

    let sent = 0, failed = 0;
    for (let i = 0; i < items.length; i++) {
        const statusEl = document.getElementById(`ms-${i}`);
        if (statusEl) { statusEl.className = 'mail-status sending'; statusEl.textContent = 'Sending...'; }

        const result = await sendReminderForItem(items[i]);

        if (result.success) {
            sent++;
            const d = getTodayDateStr();
            items[i].emailSent = d;
            localStorage.setItem(`emailSentDate_${items[i].andersonId}`, d);
            if (statusEl) { statusEl.className = 'btn-modal-send sent'; statusEl.innerHTML = '<i data-lucide="check"></i>Sent'; }
        } else {
            failed++;
            if (statusEl) { statusEl.className = 'btn-modal-send'; statusEl.innerHTML = '<i data-lucide="x"></i>Failed'; }
        }
        if (typeof lucide !== 'undefined') lucide.createIcons();

        if (btnText) btnText.textContent = `Sending ${i + 1} / ${items.length}...`;
    }

    btn.className = 'btn-send-all done';
    btn.disabled = true;
    if (btnText) btnText.textContent = `Done — ${sent} sent${failed > 0 ? `, ${failed} failed` : ''}`;
    showToast(`${sent} reminder${sent !== 1 ? 's' : ''} sent successfully.`);
    updateTatDueCount();
}

function toggleSidebar() {
    const sidebar = document.querySelector('.app-sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (!sidebar) return;
    sidebar.classList.toggle('open');
    if (overlay) overlay.classList.toggle('active');
}

async function syncData(silent = false) {
    await loadData(true, silent);
}
