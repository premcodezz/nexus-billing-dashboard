// DOM Elements
const sheetUrlInput = document.getElementById('sheet-url');
const btnSync = document.getElementById('btn-sync');
const syncStatusText = document.querySelector('#sync-status span');
const syncStatusDot = document.querySelector('#sync-status .dot');

// Permanent App Config
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycby8geERj5n0MwrPgwa69G7p5giw19T9HKfRyyRD1Amf0fbwMsk8MeceeVzxlO6EvDo/exec";
const scannerInput = document.getElementById('scanner-input');
const cartBody = document.getElementById('cart-body');
const btnClear = document.getElementById('btn-clear');
const btnCheckout = document.getElementById('btn-checkout');
const subtotalVal = document.getElementById('subtotal-val');
const totalVal = document.getElementById('total-val');

// Receipt DOM Elements
const receiptItems = document.getElementById('receipt-items');
const receiptDate = document.getElementById('receipt-date');
const receiptTotalVal = document.getElementById('receipt-total-val');

// App State
let database = new Map(); // Store products mapped by ISBN
let cart = []; // Store cart items

/**
 * JSON JSONP Callback function
 */
window.gvizCallback = function (data) {
    const btnText = btnSync.querySelector('.btn-text');
    const loader = btnSync.querySelector('.loader');

    try {
        if (!data || !data.table || !data.table.rows) throw new Error("Invalid data format received.");

        const cols = data.table.cols.map(c => (c.label || '').toLowerCase());

        let isbnIdx = cols.findIndex(h => h.includes('id') || h.includes('isbn') || h.includes('code'));
        let nameIdx = cols.findIndex(h => h.includes('name') || h.includes('product') || h.includes('title') || h.includes('item'));
        let priceIdx = cols.findIndex(h => h.includes('price') || h.includes('cost') || h.includes('amount'));

        if (isbnIdx === -1) isbnIdx = 0;
        if (nameIdx === -1) nameIdx = 1;
        if (priceIdx === -1) priceIdx = 2;

        const products = [];
        data.table.rows.forEach(row => {
            const isbnCell = row.c[isbnIdx];
            const nameCell = row.c[nameIdx];
            const priceCell = row.c[priceIdx];

            if (isbnCell && isbnCell.v != null) {
                // Formatting might be needed for numbers avoiding scientific notation, but String() usually works for standard ISBNs
                let isbnVal = isbnCell.f ? String(isbnCell.f).replace(/\,/g, '') : String(isbnCell.v);
                let nameVal = nameCell && nameCell.v != null ? String(nameCell.v) : 'Unknown';
                let priceVal = priceCell && priceCell.v != null ? parseFloat(priceCell.v) : 0;

                products.push({
                    isbn: isbnVal.replace(/\s+/g, ''),
                    name: nameVal,
                    price: priceVal
                });
            }
        });

        if (products.length === 0) throw new Error("No valid data found in sheet");

        // Populate database map
        database.clear();
        products.forEach(p => {
            if (p.isbn) database.set(p.isbn.toLowerCase(), p);
        });

        // Update UI
        syncStatusText.textContent = `Connected (${database.size} items)`;
        syncStatusDot.classList.remove('disconnected');
        syncStatusDot.classList.add('connected');
        scannerInput.disabled = false;
        scannerInput.focus();

    } catch (error) {
        console.error(error);
        alert('Failed to parse data. Ensure the Google Sheet is set to "Anyone with the link can view".');
        setDisconnectedState();
    } finally {
        if (btnText) btnText.classList.remove('hidden');
        if (loader) loader.classList.add('hidden');
        btnSync.disabled = false;
    }
};

function setDisconnectedState() {
    syncStatusText.textContent = 'Disconnected';
    syncStatusDot.classList.add('disconnected');
    syncStatusDot.classList.remove('connected');
    scannerInput.disabled = true;
}

/**
 * Handle Database Syncing via Script Injection (JSONP) to bypass CORS completely
 */
btnSync.addEventListener('click', () => {
    let url = sheetUrlInput.value.trim();
    if (!url) return alert('Please enter a Google Sheets URL');

    let docId = '';
    if (url.includes('/edit') || url.includes('/view') || url.includes('usp=sharing') || url.includes('usp=drivesdk')) {
        const urlObj = new URL(url);
        const pathSegments = urlObj.pathname.split('/');
        docId = pathSegments[pathSegments.indexOf('d') + 1];
    }

    if (!docId) {
        alert("Invalid Google Sheet URL format. Try copying standard 'view' link.");
        return;
    }

    const jsonpUrl = `https://docs.google.com/spreadsheets/d/${docId}/gviz/tq?tqx=out:json;responseHandler:gvizCallback`;

    const btnText = btnSync.querySelector('.btn-text');
    const loader = btnSync.querySelector('.loader');

    btnText.classList.add('hidden');
    loader.classList.remove('hidden');
    btnSync.disabled = true;
    syncStatusText.textContent = 'Connecting...';

    // Remove old script if exists
    const oldScript = document.getElementById('gviz-script');
    if (oldScript) oldScript.remove();

    // Inject new script
    const script = document.createElement('script');
    script.id = 'gviz-script';
    script.src = jsonpUrl;
    script.onerror = () => {
        alert("Failed to load data. The link might be incorrect or not public.");
        setDisconnectedState();
        btnText.classList.remove('hidden');
        loader.classList.add('hidden');
        btnSync.disabled = false;
    };
    document.body.appendChild(script);
});

/**
 * Scanner Input Handling
 */
scannerInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        const isbn = scannerInput.value.trim().toLowerCase();
        scannerInput.value = ''; // clear input rapidly for next scan

        if (!isbn) return;

        const product = database.get(isbn);
        if (product) {
            addToCart(product);
        } else {
            // Optional: Show brief toaster/error or just flash red
            scannerInput.style.borderColor = 'var(--danger-color)';
            setTimeout(() => { scannerInput.style.borderColor = ''; }, 500);
        }
    }
});

/**
 * Cart Logic
 */
function addToCart(product) {
    const existingItem = cart.find(item => item.isbn === product.isbn.toLowerCase());
    if (existingItem) {
        existingItem.qty += 1;
        renderCart();
        // highlight row
        const row = document.getElementById(`row-${existingItem.isbn}`);
        if (row) {
            row.classList.remove('highlight');
            void row.offsetWidth; // trigger reflow
            row.classList.add('highlight');
        }
    } else {
        cart.push({ ...product, qty: 1 });
        renderCart();
    }
}

function updateQty(isbn, change) {
    const item = cart.find(i => i.isbn === isbn);
    if (!item) return;
    item.qty += change;
    if (item.qty <= 0) {
        cart = cart.filter(i => i.isbn !== isbn);
    }
    renderCart();
}

function removeItem(isbn) {
    cart = cart.filter(i => i.isbn !== isbn);
    renderCart();
}

function formatMoney(amount) {
    return '$' + parseFloat(amount).toFixed(2);
}

function renderCart() {
    let total = 0;

    // Toggle active states
    const hasItems = cart.length > 0;
    btnClear.disabled = !hasItems;
    btnCheckout.disabled = !hasItems;

    if (!hasItems) {
        cartBody.innerHTML = `
        <tr class="empty-state">
            <td colspan="6">
                <div class="empty-cart-message">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path></svg>
                    <p>Cart is empty. Scan an item to begin.</p>
                </div>
            </td>
        </tr>`;
        subtotalVal.textContent = '$0.00';
        totalVal.textContent = '$0.00';
        return;
    }

    cartBody.innerHTML = '';

    cart.forEach(item => {
        const itemTotal = item.price * item.qty;
        total += itemTotal;

        const tr = document.createElement('tr');
        tr.id = `row-${item.isbn.toLowerCase()}`;
        tr.className = 'cart-item-row';
        tr.innerHTML = `
            <td>
                <div class="item-name">${item.name}</div>
            </td>
            <td><div class="item-isbn">${item.isbn.toUpperCase()}</div></td>
            <td class="align-right">
                <div class="item-qty">
                    <button class="qty-btn" onclick="updateQty('${item.isbn}', -1)">-</button>
                    <span>${item.qty}</span>
                    <button class="qty-btn" onclick="updateQty('${item.isbn}', 1)">+</button>
                </div>
            </td>
            <td class="align-right item-price">${formatMoney(item.price)}</td>
            <td class="align-right item-total">${formatMoney(itemTotal)}</td>
            <td class="align-right">
                <button class="icon-btn" onclick="removeItem('${item.isbn}')" title="Remove Item">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                </button>
            </td>
        `;
        cartBody.appendChild(tr);
    });

    subtotalVal.textContent = formatMoney(total);
    totalVal.textContent = formatMoney(total); // Keep same if no tax logic needed
}

btnClear.addEventListener('click', () => {
    if (confirm('Are you sure you want to clear the cart?')) {
        cart = [];
        renderCart();
    }
});

/**
 * Receipt Printing Logic
 */
btnCheckout.addEventListener('click', () => {
    if (cart.length === 0) return;

    const phoneInput = document.getElementById('customer-phone').value.trim();
    const btnText = document.getElementById('checkout-btn-text');
    const loader = btnCheckout.querySelector('.loader');

    // Populate Receipt
    const now = new Date();
    receiptDate.textContent = now.toLocaleString();

    receiptItems.innerHTML = '';
    let tTotal = 0;

    cart.forEach(item => {
        const itemTotal = item.price * item.qty;
        tTotal += itemTotal;
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${item.qty}</td>
            <td>${item.name.substring(0, 16)}</td>
            <td class="align-right">${formatMoney(itemTotal)}</td>
        `;
        receiptItems.appendChild(tr);
    });

    receiptTotalVal.textContent = formatMoney(tTotal);

    // Require a phone number to generate the digital PDF and open WhatsApp
    if (!phoneInput) {
        alert("Please enter a Customer WhatsApp Number to generate and share the digital bill.");
        return;
    }

    btnText.classList.add('hidden');
    loader.classList.remove('hidden');
    btnCheckout.disabled = true;

    const receiptContainer = document.getElementById('receipt-container');
    receiptContainer.style.display = 'block';

    const filename = `Nexus_Store_Bill_${Date.now()}.pdf`;
    const opt = {
        margin: 5,
        filename: filename,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: [80, 200], orientation: 'portrait' }
    };

    // Generate PDF, convert to base64, upload to Drive, then WhatsApp.
    html2pdf().set(opt).from(receiptContainer).output('datauristring').then(function (pdfBase64) {
        receiptContainer.style.display = ''; // reset to normal hidden state

        // Prepare the payload for Apps Script
        const payload = JSON.stringify({
            base64: pdfBase64,
            filename: filename,
            folderId: '15QEZhWbjviHTUYW5XUtvP8E-i4xPtC8e'
        });

        // Send simple POST request without custom headers to avoid CORS preflight entirely.
        // Google Apps Script will parse this payload in e.postData.contents.
        return fetch(APPS_SCRIPT_URL, {
            method: 'POST',
            body: payload
        });
    })
        .then(response => {
            // Apps script often responds with a redirect (302) on POST before giving JSON, 
            // but the fetch API transparently follows it. We just need to parse the final response.
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(result => {
            if (result.status === 'success') {
                // Result MUST have .url from our script
                console.log("Upload Success! URL:", result.url);

                const cleanPhone = phoneInput.replace(/\D/g, '');
                const message = encodeURIComponent(`Hello! Thank you for your purchase from Nexus Store.\n\nPlease find your digital bill here: ${result.url}`);
                const waLink = `https://wa.me/${cleanPhone}?text=${message}`;

                // 1. Open WhatsApp with link
                window.open(waLink, '_blank');

            } else {
                throw new Error(result.message || 'Unknown error during upload');
            }
        })
        .catch(error => {
            console.error("Upload Error:", error);
            alert(`Failed to upload the bill to Google Drive. Error: ${error.message}\nCheck the console for details.`);
        })
        .finally(() => {
            btnText.classList.remove('hidden');
            loader.classList.add('hidden');
            btnCheckout.disabled = false;
        });
});
