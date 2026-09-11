/* =========================================================================
   Kolkata Auto Center - Frontend logic
   This file talks to the backend API and updates the HTML page.
   API_BASE points at your locally running FastAPI server.
   ========================================================================= */

const API_BASE = "https://kolkata-auto-center-api.onrender.com";
const OWNER_UPI = "9438108296@ybl";
const OWNER_NAME = "admin7";
const OWNER_EMAIL = "admin7@gmail.com";

// ---- Small helpers -------------------------------------------------------

function $(id) { return document.getElementById(id); }

function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2200);
}

function money(n) { return "₹" + Number(n).toFixed(2); }

function getToken() { return localStorage.getItem("kac_jwt_token"); }
function getUser() {
  const raw = localStorage.getItem("kac_user");
  return raw ? JSON.parse(raw) : null;
}
function isOwner(user) {
  return user?.role === "owner" && user.name === OWNER_NAME && user.email?.toLowerCase() === OWNER_EMAIL;
}
function setSession(token, user) {
  localStorage.setItem("kac_jwt_token", token);
  localStorage.setItem("kac_user", JSON.stringify(user));
}
function clearSession() {
  localStorage.removeItem("kac_jwt_token");
  localStorage.removeItem("kac_user");
}

function getCart() {
  const raw = localStorage.getItem("kac_cart");
  return raw ? JSON.parse(raw) : [];
}
function setCart(cart) {
  localStorage.setItem("kac_cart", JSON.stringify(cart));
  renderCartCount();
}

async function api(path, { method = "GET", body, auth = false } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth) {
    const token = getToken();
    if (token) headers["Authorization"] = "Bearer " + token;
  }
  const res = await fetch(API_BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    clearSession();
    refreshUserUI();
    if ($("loginOverlay")) openLoginModal();
  }
  if (!res.ok) throw new Error(data.detail || "Something went wrong");
  return data;
}

// ---- Catalog rendering ----------------------------------------------------

let allProducts = [];
let checkoutPending = false;

function stockBadge(stock) {
  if (stock === 0) return `<span class="badge red">Out of stock</span>`;
  if (stock <= 3) return `<span class="badge yellow">Only ${stock} left</span>`;
  return `<span class="badge green">In stock · ${stock}</span>`;
}

async function loadCategories() {
  const cats = await api("/categories");
  const sel = $("categorySelect");
  sel.innerHTML = `<option value="All">All Categories</option>` +
    cats.map(c => `<option value="${c}">${c}</option>`).join("");
}

async function loadProducts() {
  const search = $("searchInput").value.trim();
  const category = $("categorySelect").value;
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (category && category !== "All") params.set("category", category);
  allProducts = await api("/products?" + params.toString());
  renderProducts();
}

function renderProducts() {
  const grid = $("productGrid");
  if (allProducts.length === 0) {
    grid.innerHTML = `<div class="empty">No parts found.</div>`;
    return;
  }
  grid.innerHTML = allProducts.map(p => `
    <div class="card">
      ${p.image ? `<img src="${p.image}" alt="${p.name}" />` : `<div class="img-placeholder">No image</div>`}
      <h3>${p.name}</h3>
      <div class="meta">${p.category} · SKU ${p.sku}</div>
      ${stockBadge(p.stock)}
      <div class="price">${money(p.price)}</div>
      <button class="btn" ${p.stock === 0 ? "disabled" : ""} onclick="addToCart('${p.id}')">
        ${p.stock === 0 ? "Out of stock" : "Add to Cart"}
      </button>
    </div>
  `).join("");
}

// ---- Cart -------------------------------------------------------------

function addToCart(productId) {
  const product = allProducts.find(p => p.id === productId);
  if (!product) return;
  const cart = getCart();
  const existing = cart.find(i => i.product_id === productId);
  if (existing) {
    if (existing.qty >= product.stock) { toast("No more stock available"); return; }
    existing.qty += 1;
  } else {
    cart.push({ product_id: product.id, name: product.name, price: product.price, qty: 1, maxStock: product.stock });
  }
  setCart(cart);
  toast("Added to cart");
}

function changeQty(productId, delta) {
  const cart = getCart();
  const item = cart.find(i => i.product_id === productId);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) {
    setCart(cart.filter(i => i.product_id !== productId));
  } else {
    setCart(cart);
  }
  renderCart();
}

function cartTotalAmount() {
  return getCart().reduce((sum, i) => sum + i.qty * i.price, 0);
}

function renderCartCount() {
  const count = getCart().reduce((s, i) => s + i.qty, 0);
  const el = $("cartCount");
  el.textContent = count;
  el.classList.toggle("hidden", count === 0);
}

function renderCart() {
  const cart = getCart();
  const container = $("cartItemsContainer");
  if (cart.length === 0) {
    container.innerHTML = `<div class="empty">Your cart is empty.</div>`;
  } else {
    container.innerHTML = cart.map(i => `
      <div class="cart-item">
        <div class="info">
          <div>${i.name}</div>
          <div class="meta">${money(i.price)} each</div>
        </div>
        <div class="qty-ctrl">
          <button onclick="changeQty('${i.product_id}', -1)">-</button>
          <span>${i.qty}</span>
          <button onclick="changeQty('${i.product_id}', 1)">+</button>
        </div>
      </div>
    `).join("");
  }
  $("cartTotalDisplay").textContent = money(cartTotalAmount());
}

// ---- Auth / login flow --------------------------------------------------

function refreshUserUI() {
  const user = getUser();
  const owner = isOwner(user);
  if (user) {
    $("navLoginBtn").classList.add("hidden");
    $("logoutBtn").classList.remove("hidden");
    $("userBadge").classList.remove("hidden");
    $("userNameDisplay").textContent = user.name + (owner ? " (Owner)" : "");
    $("navOrdersBtn").classList.toggle("hidden", owner);
    $("cartBtn").classList.toggle("hidden", owner);
    $("navDashboardBtn").classList.toggle("hidden", !owner);
  } else {
    $("navLoginBtn").classList.remove("hidden");
    $("logoutBtn").classList.add("hidden");
    $("userBadge").classList.add("hidden");
    $("navOrdersBtn").classList.add("hidden");
    $("navDashboardBtn").classList.add("hidden");
    //$("cartBtn").classList.add("hidden");
  }
}

function requireLogin() {
  if (!getUser() || !getToken()) {
    clearSession();
    refreshUserUI();
    toast("Please login first");
    openLoginModal();
    return false;
  }
  return true;
}

// ---- Checkout -------------------------------------------------------------

function openCheckout() {
  if (getCart().length === 0) { toast("Your cart is empty"); return; }
  if (!requireLogin()) {
    checkoutPending = true;
    return;
  }
  $("cartOverlay").classList.add("checkout-mode");
  $("cartDialogTitle").textContent = "Order Items";
  $("checkoutFormSection").classList.remove("hidden");
}

function renderUpiQr() {
  $("upiFieldSection").classList.remove("hidden");
}

async function placeOrder() {
  if (!requireLogin()) return;

  const phone = $("orderPhone").value.trim();
  const address = $("orderAddress").value.trim();
  const payment = $("paymentMethodSelect").value;
  const utr = $("orderUtr").value.trim();
  const transactionId = $("orderTransactionId").value.trim();
  const user = getUser();

  if (!phone) { toast("Contact Phone is required"); $("orderPhone").focus(); return; }
  if (!/^\d{10}$/.test(phone)) {
    toast("Enter a valid 10-digit phone number");
    $("orderPhone").focus();
    return;
  }
  if (!address) { toast("Delivery Address is required"); $("orderAddress").focus(); return; }
  if (!payment) { toast("Payment Method is required"); $("paymentMethodSelect").focus(); return; }
  if (payment === "UPI" && !/^\d{12}$/.test(utr)) {
    toast("Enter a valid 12-digit UTR number"); $("orderUtr").focus(); return;
  }
  if (payment === "UPI" && !transactionId) {
    toast("Transaction ID is required"); $("orderTransactionId").focus(); return;
  }

  const cart = getCart();
  try {
    const order = await api("/orders", {
      method: "POST",
      auth: true,
      body: {
        customer_name: user.name,
        phone,
        address,
        payment_method: payment === "UPI" ? "upi" : "cod",
        utr_number: payment === "UPI" ? utr : null,
        transaction_id: payment === "UPI" ? transactionId : null,
        items: cart.map(i => ({ product_id: i.product_id, name: i.name, qty: i.qty, price: i.price })),
      },
    });
    toast("Order placed! Total " + money(order.total_amount));
    setCart([]);
    $("cartOverlay").classList.remove("open");
    $("cartOverlay").classList.remove("checkout-mode");
    $("cartDialogTitle").textContent = "Shopping Cart";
    $("checkoutFormSection").classList.add("hidden");
    await loadProducts();
  } catch (e) {
    toast(e.message);
  }
}

// ---- Order history + PDF invoices -----------------------------------------

async function openMyOrders() {
  if (!requireLogin()) return;
  const orders = await api("/orders/mine", { auth: true });
  const container = $("ordersList");
  if (orders.length === 0) {
    container.innerHTML = `<div class="empty">No orders yet.</div>`;
  } else {
    container.innerHTML = orders.map(o => `
      <div style="border:1px solid #e4e4e7;border-radius:8px;padding:12px;margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;">
          <strong>${money(o.total_amount)}</strong>
          <span class="badge ${statusColor(o.status)}">${o.status}</span>
        </div>
        <div class="meta">${new Date(o.created_at * 1000).toLocaleString()}</div>
        <div class="meta">${o.items}</div>
        <button class="btn small secondary" style="margin-top:8px;" onclick='downloadInvoice(${JSON.stringify(o).replace(/'/g, "&#39;")})'>Download Invoice PDF</button>
      </div>
    `).join("");
  }
  $("ordersOverlay").classList.add("open");
}

function statusColor(status) {
  if (status === "Delivered") return "green";
  if (status === "Cancelled") return "red";
  return "yellow";
}

function downloadInvoice(order) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFontSize(16);
  doc.text("Kolkata Auto Center", 14, 18);
  doc.setFontSize(10);
  doc.text("Tax Invoice / Receipt", 14, 25);
  doc.text(`Order ID: ${order.id}`, 14, 32);
  doc.text(`Date: ${new Date(order.created_at * 1000).toLocaleString()}`, 14, 38);
  doc.text(`Customer: ${order.customer_name}   Phone: ${order.phone}`, 14, 44);
  doc.text(`Delivery Address: ${order.address}`, 14, 50);
  if (order.utr_number) doc.text(`UPI UTR: ${order.utr_number}`, 14, 56);

  const rows = order.items.split(";").map(s => s.trim()).filter(Boolean).map(s => {
    const m = s.match(/(.+) x(\d+) \(Rs\.([\d.]+)\)/);
    return m ? [m[1], m[2], `Rs.${m[3]}`, `Rs.${(m[2] * m[3]).toFixed(2)}`] : [s, "", "", ""];
  });

  doc.autoTable({
    startY: 62,
    head: [["Item", "Qty", "Unit Price", "Line Total"]],
    body: rows,
  });

  const finalY = doc.lastAutoTable.finalY || 70;
  doc.setFontSize(12);
  doc.text(`Total Payable: Rs.${Number(order.total_amount).toFixed(2)}`, 14, finalY + 10);

  doc.save(`invoice-${order.id.slice(0, 8)}.pdf`);
}

// ---- Owner dashboard --------------------------------------------------

async function loadOwnerProducts() {
  const products = await api("/products");
  const tbody = document.querySelector("#ownerProductTable tbody");
  tbody.innerHTML = products.map(p => `
    <tr>
      <td>${p.name}</td>
      <td>${p.category}</td>
      <td>${p.sku}</td>
      <td>
        <input type="number" step="0.01" id="price_${p.id}" value="${p.price}" style="width: 90px; padding: 4px 6px;" />
      </td>
      <td>
        <input type="number" id="stock_${p.id}" value="${p.stock}" style="width: 70px; padding: 4px 6px;" />
      </td>
      <td style="display: flex; gap: 6px;">
        <button class="btn small" onclick="saveProductEdit('${p.id}')">Save</button>
        <button class="btn small danger" onclick="deleteProduct('${p.id}')">Delete</button>
      </td>
    </tr>
  `).join("");
}

async function saveProductEdit(id) {
  const newPrice = parseFloat($(`price_${id}`).value);
  const newStock = parseInt($(`stock_${id}`).value, 10);

  if (isNaN(newPrice) || isNaN(newStock)) {
    toast("Please enter valid price and stock numbers");
    return;
  }

  try {
    await api(`/products/${id}`, {
      method: "PUT",
      auth: true,
      body: { price: newPrice, stock: newStock }
    });
    toast("Updated successfully!");
    await loadProducts();
  } catch (err) {
    toast(err.message);
  }
}

async function deleteProduct(id) {
  if (!confirm("Delete this part?")) return;
  await api(`/products/${id}`, { method: "DELETE", auth: true });
  toast("Deleted");
  await loadOwnerProducts();
  await loadProducts();
  await loadCategories();
}

async function loadOwnerOrders() {
  const orders = await api("/orders", { auth: true });
  const tbody = document.querySelector("#ownerOrdersTable tbody");
  const statuses = ["Pending", "Confirmed", "Dispatched", "Delivered", "Cancelled"];
  tbody.innerHTML = orders.map(o => `
    <tr>
      <td>${new Date(o.created_at * 1000).toLocaleDateString()}</td>
      <td>${o.customer_name}<br><span class="meta">${o.phone}</span></td>
      <td class="order-items">${o.items}</td>
      <td class="order-total">${money(o.total_amount)}</td>
      <td class="order-payment">${o.payment_method.toUpperCase()}</td>
      <td class="payment-details">
        ${o.payment_method === "upi"
          ? `UTR: ${o.utr_number || "-"}<br>Transaction ID: ${o.transaction_id || "-"}`
          : "-"}
      </td>
      <td>
        <select class="status-select" onchange="updateOrderStatus('${o.id}', this.value)">
          ${statuses.map(s => `<option ${s === o.status ? "selected" : ""}>${s}</option>`).join("")}
        </select>
      </td>
      <td><button class="btn small secondary" onclick='sendWhatsapp(${JSON.stringify(o).replace(/'/g, "&#39;")})'>WhatsApp</button></td>
    </tr>
  `).join("");
}

async function updateOrderStatus(orderId, status) {
  await api(`/orders/${orderId}/status`, { method: "PUT", auth: true, body: { status } });
  toast("Order status updated");
}

function sendWhatsapp(order) {
  const text = `Hi ${order.customer_name}, your Kolkata Auto Center order (Total: Rs.${order.total_amount}) is now "${order.status}".\nItems: ${order.items}`;
  const phoneDigits = order.phone.replace(/\D/g, "");
  window.open(`https://wa.me/91${phoneDigits}?text=${encodeURIComponent(text)}`, "_blank");
}

const addProductForm = $("addProductForm");
if (addProductForm) addProductForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await api("/products", {
      method: "POST",
      auth: true,
      body: {
        name: $("p_name").value,
        category: $("p_category").value,
        sku: $("p_sku").value,
        price: parseFloat($("p_price").value),
        stock: parseInt($("p_stock").value, 10),
        image: $("p_image").value,
      },
    });
    toast("Part added");
    e.target.reset();
    await loadOwnerProducts();
    await loadProducts();
    await loadCategories();
  } catch (err) {
    toast(err.message);
  }
});

// ---- Event wiring -----------------------------------------------------

$("searchInput").addEventListener("input", debounce(loadProducts, 300));
$("categorySelect").addEventListener("change", loadProducts);

$("cartBtn").addEventListener("click", () => {
  renderCart();
  $("cartOverlay").classList.remove("checkout-mode");
  $("cartDialogTitle").textContent = "Shopping Cart";
  $("checkoutFormSection").classList.add("hidden");
  $("upiFieldSection").classList.add("hidden");
  $("cartOverlay").classList.add("open");
});
$("closeCartBtn").addEventListener("click", () => {
  $("cartOverlay").classList.remove("open", "checkout-mode");
  $("cartDialogTitle").textContent = "Shopping Cart";
});
$("checkoutProceedBtn").addEventListener("click", openCheckout);
$("submitOrderBtn").addEventListener("click", placeOrder);

$("paymentMethodSelect").addEventListener("change", () => {
  const isUpi = $("paymentMethodSelect").value === "UPI";
  $("upiFieldSection").classList.toggle("hidden", !isUpi);
  if (isUpi) renderUpiQr();
});

function openLoginModal() {
  $("loginStep1").classList.remove("hidden");
  $("loginStep2").classList.add("hidden");
  $("loginOverlay").classList.add("open");
}

$("navLoginBtn").addEventListener("click", () => {
  openLoginModal();
});
$("cancelLoginBtn").addEventListener("click", () => $("loginOverlay").classList.remove("open"));
$("closeLoginBtn").addEventListener("click", () => $("loginOverlay").classList.remove("open"));
$("backLoginBtn").addEventListener("click", () => {
  $("loginStep1").classList.remove("hidden");
  $("loginStep2").classList.add("hidden");
});

function showOtpStep() {
  $("loginOverlay").classList.add("open");
  $("loginStep1").classList.add("hidden");
  $("loginStep2").classList.remove("hidden");
  $("loginOtp").value = "";
  $("loginOtp").focus();
}

// 1. Send OTP: stop propagation and prevent default behavior
$("sendOtpBtn").addEventListener("click", async (e) => {
  e.preventDefault();
  e.stopPropagation();
  
  const email = $("loginEmail").value.trim();
  const name = $("loginName").value.trim() || email.split("@")[0];
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    toast("Enter a valid email address");
    return;
  }
  
  try {
    await api("/auth/request-otp", { method: "POST", body: { email, name } });
    showOtpStep();
    toast("OTP sent to your mail id.");
  } catch (err) {
    $("loginOverlay").classList.add("open");
    toast(err.message);
  }
});

$("verifyOtpBtn").addEventListener("click", async () => {
  const email = $("loginEmail").value.trim();
  const otp = $("loginOtp").value.trim();
  try {
    const result = await api("/auth/verify-otp", { method: "POST", body: { email, otp } });
    setSession(result.token, result.user);
    refreshUserUI();
    $("loginOverlay").classList.remove("open");
    if (checkoutPending) {
      checkoutPending = false;
      $("cartOverlay").classList.add("open");
      openCheckout();
    }
    toast("Welcome, " + result.user.name + "!");
  } catch (e) { toast(e.message); }
});

$("logoutBtn").addEventListener("click", () => {
  clearSession();
  refreshUserUI();
  $("ownerOverlay").classList.remove("open");
  toast("Logged out");
});

$("navOrdersBtn").addEventListener("click", openMyOrders);
$("closeOrdersBtn").addEventListener("click", () => $("ordersOverlay").classList.remove("open"));

$("navDashboardBtn").addEventListener("click", async () => {
  $("ownerOverlay").classList.add("open");
  await loadOwnerProducts();
  await loadOwnerOrders();
});
$("closeOwnerBtn").addEventListener("click", () => $("ownerOverlay").classList.remove("open"));
$("addProductBtn").addEventListener("click", async () => {
  const product = {
    name: $("newProdName").value.trim(),
    category: $("newProdCategory").value.trim(),
    sku: $("newProdSku").value.trim(),
    price: parseFloat($("newProdPrice").value),
    stock: parseInt($("newProdStock").value, 10),
    image: $("newProdImage").value.trim(),
  };

  if (!product.name || !product.category || !product.sku || isNaN(product.price) || isNaN(product.stock)) {
    toast("Please fill all product fields");
    return;
  }

  try {
    await api("/products", { method: "POST", auth: true, body: product });
    ["newProdName", "newProdCategory", "newProdSku", "newProdPrice", "newProdStock", "newProdImage"]
      .forEach(id => $(id).value = "");
    toast("Product added");
    await loadOwnerProducts();
    await loadProducts();
    await loadCategories();
  } catch (err) {
    toast(err.message);
  }
});
$("tabInventoryBtn").addEventListener("click", () => {
  $("tabInventoryBtn").classList.add("active");
  $("tabOrdersBtn").classList.remove("active");
  $("ownerInventoryTab").classList.remove("hidden");
  $("ownerOrdersTab").classList.add("hidden");
});
$("tabOrdersBtn").addEventListener("click", async () => {
  $("tabOrdersBtn").classList.add("active");
  $("tabInventoryBtn").classList.remove("active");
  $("ownerOrdersTab").classList.remove("hidden");
  $("ownerInventoryTab").classList.add("hidden");
  await loadOwnerOrders();
});

// close overlays only when clicking directly on the backdrop itself
document.querySelectorAll(".overlay").forEach(ov => {
  ov.addEventListener("mousedown", (e) => {
    if (e.target === ov && ov.id !== "loginOverlay") {
      ov.classList.remove("open");
    }
  });
});

$("loginOverlay").addEventListener("click", (e) => {
  if (e.target === $("loginOverlay")) e.stopPropagation();
});

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ---- Init -----------------------------------------------------------------

(async function init() {
  refreshUserUI();
  renderCartCount();
  try {
    await loadCategories();
    await loadProducts();
  } catch (e) {
    toast("Cannot reach backend. Is the server running?");
  }
})();
