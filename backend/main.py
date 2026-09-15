"""
Kolkata Auto Center - Backend API
----------------------------------
This is the "server" of the website. It stores everything in a single
file called shop.db (an SQLite database — think of it like an Excel
file that code can read/write very fast).

HOW TO RUN THIS (also explained in README.md):
    1. Open a terminal in the "backend" folder.
    2. pip install -r requirements.txt
    3. uvicorn main:app --reload

That's it. The server will start at http://127.0.0.1:8000
"""

import os
import re
import json
import sqlite3
import time
import uuid
import random
import requests
from contextlib import contextmanager

import jwt
from fastapi import FastAPI, HTTPException, Header, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List

# ---------------------------------------------------------------------------
# 1. BASIC SETUP
# ---------------------------------------------------------------------------

APP_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(APP_DIR, "shop.db")

OWNER_NAME = os.environ.get("OWNER_NAME", "admin7")
OWNER_EMAIL = os.environ.get("OWNER_EMAIL", "admin7@gmail.com").lower()
TEST_EMAIL = "test@kolkataauto.com"
TEST_OTP = "123456"
JWT_SECRET = os.environ.get("JWT_SECRET", "dev-secret-change-me-in-production")
RESEND_API_KEY = os.environ.get("RESEND_API_KEY")
JWT_ALGO = "HS256"
OTP_TTL_SECONDS = 10 * 60  # 10 minutes

app = FastAPI(title="Kolkata Auto Center API")

# FR: open CORS so the separately-hosted frontend can call this API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# 2. DATABASE HELPERS
# ---------------------------------------------------------------------------

@contextmanager
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db():
    with get_db() as db:
        db.execute("""CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            name TEXT
        )""")
        db.execute("""CREATE TABLE IF NOT EXISTS otps (
            email TEXT PRIMARY KEY,
            otp TEXT NOT NULL,
            expires_at REAL NOT NULL,
            name TEXT
        )""")
        db.execute("""CREATE TABLE IF NOT EXISTS products (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            category TEXT,
            sku TEXT,
            price REAL NOT NULL,
            stock INTEGER NOT NULL DEFAULT 0,
            image TEXT,
            created_at REAL
        )""")
        db.execute("""CREATE TABLE IF NOT EXISTS orders (
            id TEXT PRIMARY KEY,
            user_id TEXT,
            customer_name TEXT,
            phone TEXT,
            address TEXT,
            payment_method TEXT,
            total_amount REAL,
            items TEXT,
            utr_number TEXT,
            status TEXT DEFAULT 'Pending',
            created_at REAL
        )""")
        try:
            db.execute("ALTER TABLE orders ADD COLUMN transaction_id TEXT")
        except sqlite3.OperationalError:
            pass
        try:
            db.execute("ALTER TABLE orders ADD COLUMN items_data TEXT")
        except sqlite3.OperationalError:
            pass
        db.execute("""CREATE TABLE IF NOT EXISTS order_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id TEXT NOT NULL,
            product_id TEXT NOT NULL,
            quantity INTEGER NOT NULL,
            price REAL NOT NULL,
            FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
        )""")

        # Seed a few sample products so the site isn't empty on first run.
        count = db.execute("SELECT COUNT(*) c FROM products").fetchone()["c"]
        if count == 0:
            sample = [
                ("Brake Pad Set - Front", "Brakes", "BRK-1001", 899.0, 12),
                ("Engine Oil Filter", "Engine", "ENG-2002", 249.0, 3),
                ("Headlight Bulb H4", "Electrical", "ELE-3003", 349.0, 0),
                ("Clutch Cable", "Transmission", "TRN-4004", 599.0, 8),
            ]
            for name, cat, sku, price, stock in sample:
                db.execute(
                    "INSERT INTO products (id,name,category,sku,price,stock,image,created_at) "
                    "VALUES (?,?,?,?,?,?,?,?)",
                    (uuid.uuid4().hex, name, cat, sku, price, stock, "", time.time()),
                )


init_db()


# ---------------------------------------------------------------------------
# 3. AUTH HELPERS (JWT + OTP)
# ---------------------------------------------------------------------------

def create_jwt(email: str, name: str, role: str) -> str:
    payload = {"email": email, "name": name, "role": role, "iat": time.time()}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)


def current_user(authorization: Optional[str]):
    """Reads the 'Authorization: Bearer <token>' header and returns the user,
    or raises a 401 error if missing/invalid."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not logged in")
    token = authorization.split(" ", 1)[1]
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    return payload


def require_owner(authorization: Optional[str]):
    user = current_user(authorization)
    if (
        user.get("role") != "owner"
        or user.get("name") != OWNER_NAME
        or user.get("email", "").lower() != OWNER_EMAIL
    ):
        raise HTTPException(status_code=403, detail="Owner access only")
    return user


def send_real_otp(to_email: str, otp: str):
    # If no email API key is configured (local testing), print to the terminal
    if not RESEND_API_KEY:
        print(f"\n==================================================")
        print(f"  [LOCAL MODE] OTP for {to_email} is: {otp}")
        print(f"==================================================\n", flush=True)
        return

    # Real email delivery when deployed with an API key
    try:
        res = requests.post(
            "https://api.resend.com/emails",
            headers={
                "Authorization": f"Bearer {RESEND_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "from": "Kolkata Auto Center <onboarding@resend.dev>",
                "to": [to_email],
                "subject": f"Your Kolkata Auto Center OTP is {otp}",
                "html": f"<p>Your login OTP code is: <strong>{otp}</strong>. It expires in 10 minutes.</p>",
            },
            timeout=10,
        )
        if res.status_code >= 400:
            print("Email delivery failed:", res.text, flush=True)
    except Exception as e:
        print("Email sending error:", e, flush=True)


# ---------------------------------------------------------------------------
# 4. REQUEST/RESPONSE MODELS
# ---------------------------------------------------------------------------

class RequestOtpBody(BaseModel):
    email: str
    name: Optional[str] = None


class VerifyOtpBody(BaseModel):
    email: str
    otp: str


class ProductBody(BaseModel):
    name: str
    category: str
    sku: str
    price: float
    stock: int
    image: Optional[str] = ""


class ProductUpdateBody(BaseModel):
    price: float
    stock: int


class OrderItem(BaseModel):
    product_id: str
    name: str
    qty: int
    price: float


class OrderBody(BaseModel):
    customer_name: str
    phone: str
    address: str
    payment_method: str  # "cod" or "upi"
    utr_number: Optional[str] = None
    transaction_id: Optional[str] = None
    items: List[OrderItem]


class StatusBody(BaseModel):
    status: str


# ---------------------------------------------------------------------------
# 5. AUTH ENDPOINTS
# ---------------------------------------------------------------------------

@app.post("/auth/request-otp")
def request_otp(body: RequestOtpBody):
    email = body.email.strip().lower()
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        raise HTTPException(400, "Enter a valid email address")
    is_test_account = email == TEST_EMAIL
    otp = TEST_OTP if is_test_account else f"{random.randint(0, 999999):06d}"
    expires_at = time.time() + OTP_TTL_SECONDS
    with get_db() as db:
        db.execute(
            "INSERT INTO otps (email, otp, expires_at, name) VALUES (?,?,?,?) "
            "ON CONFLICT(email) DO UPDATE SET otp=excluded.otp, expires_at=excluded.expires_at, name=excluded.name",
            (email, otp, expires_at, body.name.strip() if body.name else ""),
        )
    if is_test_account:
        return {"message": "OTP sent successfully"}
    send_real_otp(email, otp)
    return {"message": "OTP generated. Check the backend terminal."}


@app.post("/auth/verify-otp")
def verify_otp(body: VerifyOtpBody):
    email = body.email.strip().lower()
    is_test_account = email == TEST_EMAIL
    with get_db() as db:
        row = db.execute("SELECT * FROM otps WHERE email=?", (email,)).fetchone()
        if not row and not is_test_account:
            raise HTTPException(400, "No OTP was requested for this email")
        if not is_test_account:
            if time.time() > row["expires_at"]:
                raise HTTPException(400, "OTP expired, please request a new one")
            if row["otp"] != body.otp.strip():
                raise HTTPException(400, "Incorrect OTP")

        user = db.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
        if not user:
            db.execute(
                "INSERT INTO users (id, email, name) VALUES (?,?,?)",
                (uuid.uuid4().hex, email, (row["name"] if row else "") or email.split("@")[0]),
            )
            user = db.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()

        db.execute("DELETE FROM otps WHERE email=?", (email,))

        is_owner = (email == OWNER_EMAIL)
        role = "owner" if is_owner else "customer"
        user_name = OWNER_NAME if is_owner else user["name"]
        token = create_jwt(user["email"], user_name, role)
        return {"token": token, "user": {"email": user["email"], "name": user_name, "role": role}}


# ---------------------------------------------------------------------------
# 6. PRODUCT / CATALOG ENDPOINTS
# ---------------------------------------------------------------------------

@app.get("/products")
def list_products(search: Optional[str] = Query(None), category: Optional[str] = Query(None)):
    with get_db() as db:
        query = "SELECT * FROM products WHERE 1=1"
        params = []
        if search:
            query += " AND (name LIKE ? OR sku LIKE ? OR category LIKE ?)"
            like = f"%{search}%"
            params += [like, like, like]
        if category and category != "All":
            query += " AND category = ?"
            params.append(category)
        query += " ORDER BY created_at DESC"
        rows = db.execute(query, params).fetchall()
        return [dict(r) for r in rows]


@app.get("/categories")
def list_categories():
    with get_db() as db:
        rows = db.execute("SELECT DISTINCT category FROM products WHERE category IS NOT NULL").fetchall()
        return sorted({r["category"] for r in rows if r["category"]})


@app.post("/products")
def create_product(body: ProductBody, authorization: Optional[str] = Header(None)):
    require_owner(authorization)
    with get_db() as db:
        pid = uuid.uuid4().hex
        db.execute(
            "INSERT INTO products (id,name,category,sku,price,stock,image,created_at) VALUES (?,?,?,?,?,?,?,?)",
            (pid, body.name, body.category, body.sku, body.price, body.stock, body.image, time.time()),
        )
        return {"id": pid}


@app.put("/products/{product_id}")
def update_product(product_id: str, body: ProductUpdateBody, authorization: Optional[str] = Header(None)):
    require_owner(authorization)
    with get_db() as db:
        existing = db.execute("SELECT id FROM products WHERE id=?", (product_id,)).fetchone()
        if not existing:
            raise HTTPException(404, "Product not found")
        db.execute("UPDATE products SET price=?, stock=? WHERE id=?", (body.price, body.stock, product_id))
        return {"message": "updated"}


@app.delete("/products/{product_id}")
def delete_product(product_id: str, authorization: Optional[str] = Header(None)):
    require_owner(authorization)
    with get_db() as db:
        db.execute("DELETE FROM products WHERE id=?", (product_id,))
        return {"message": "deleted"}


# ---------------------------------------------------------------------------
# 7. ORDER ENDPOINTS
# ---------------------------------------------------------------------------

@app.post("/orders")
def create_order(body: OrderBody, authorization: Optional[str] = Header(None)):
    user = current_user(authorization)

    if body.payment_method == "upi":
        utr = (body.utr_number or "").strip()
        if not re.fullmatch(r"\d{12}", utr):
            raise HTTPException(400, "A valid 12-digit UPI Reference/UTR number is required")
        transaction_id = (body.transaction_id or "").strip()
        if not transaction_id:
            raise HTTPException(400, "UPI Transaction ID is required")

    with get_db() as db:
        # check + deduct stock (FR-ORD-05)
        quantities_by_product = {}
        for item in body.items:
            if item.qty <= 0:
                raise HTTPException(400, "Insufficient stock for item")
            quantities_by_product[item.product_id] = quantities_by_product.get(item.product_id, 0) + item.qty
        for product_id, quantity in quantities_by_product.items():
            prod = db.execute("SELECT stock FROM products WHERE id=?", (product_id,)).fetchone()
            if not prod or prod["stock"] < quantity:
                raise HTTPException(400, "Insufficient stock for item")
        for item in body.items:
            db.execute("UPDATE products SET stock = stock - ? WHERE id=?", (item.qty, item.product_id))

        total = sum(i.qty * i.price for i in body.items)
        items_str = "; ".join(f"{i.name} x{i.qty} (Rs.{i.price})" for i in body.items)
        items_data = json.dumps([
            {"product_id": i.product_id, "qty": i.qty} for i in body.items
        ])
        oid = uuid.uuid4().hex

        db.execute(
                """INSERT INTO orders (id,user_id,customer_name,phone,address,payment_method,
                    total_amount,items,utr_number,transaction_id,status,created_at,items_data)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (oid, user["email"], body.customer_name, body.phone, body.address,
                 body.payment_method, total, items_str, body.utr_number, body.transaction_id,
                 "Pending", time.time(), items_data),
        )
        db.executemany(
            "INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (?,?,?,?)",
            [(oid, item.product_id, item.qty, item.price) for item in body.items],
        )
        return {"id": oid, "total_amount": total}


@app.get("/orders/mine")
def my_orders(authorization: Optional[str] = Header(None)):
    user = current_user(authorization)
    with get_db() as db:
        rows = db.execute(
            "SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC", (user["email"],)
        ).fetchall()
        return [dict(r) for r in rows]


@app.get("/orders")
def all_orders(authorization: Optional[str] = Header(None)):
    require_owner(authorization)
    with get_db() as db:
        rows = db.execute("SELECT * FROM orders ORDER BY created_at DESC").fetchall()
        return [dict(r) for r in rows]


@app.put("/orders/{order_id}/status")
def update_status(order_id: str, body: StatusBody, authorization: Optional[str] = Header(None)):
    allowed = {"Pending", "Confirmed", "Dispatched", "Delivered", "Cancelled"}
    normalized_status = next(
        (status for status in allowed if status.lower() == body.status.strip().lower()),
        None,
    )
    if not normalized_status:
        raise HTTPException(400, "Invalid status")
    user = current_user(authorization)
    is_cancellation = normalized_status == "Cancelled"
    with get_db() as db:
        order = db.execute(
            "SELECT status, user_id, items, items_data FROM orders WHERE id=?", (order_id,)
        ).fetchone()
        if not order:
            raise HTTPException(404, "Order not found")

        if is_cancellation:
            is_owner = (
                user.get("role") == "owner"
                and user.get("name") == OWNER_NAME
                and user.get("email", "").lower() == OWNER_EMAIL
            )
            if not is_owner and order["user_id"] != user.get("email"):
                raise HTTPException(403, "You can only cancel your own orders")
            if (order["status"] or "").lower() == "cancelled":
                raise HTTPException(400, "Order is already cancelled")

            order_items = db.execute(
                "SELECT product_id, quantity AS qty FROM order_items WHERE order_id=?",
                (order_id,),
            ).fetchall()
            if order_items:
                items = order_items
            elif order["items_data"]:
                try:
                    items = json.loads(order["items_data"])
                except (TypeError, json.JSONDecodeError):
                    raise HTTPException(400, "Order inventory details are invalid")
            else:
                items = []
                for legacy_item in (order["items"] or "").split(";"):
                    match = re.fullmatch(r"\s*(.+?) x(\d+) \(Rs\.[^)]+\)\s*", legacy_item)
                    if not match:
                        raise HTTPException(400, "Order inventory details are unavailable")
                    product = db.execute(
                        "SELECT id FROM products WHERE name=? LIMIT 1", (match.group(1),)
                    ).fetchone()
                    if not product:
                        raise HTTPException(400, "A product in this order no longer exists")
                    items.append({"product_id": product["id"], "qty": int(match.group(2))})

            for item in items:
                if isinstance(item, sqlite3.Row):
                    product_id = item["product_id"]
                    quantity = item["qty"]
                else:
                    product_id = item.get("product_id")
                    quantity = item.get("qty")
                if not product_id or not isinstance(quantity, int) or quantity <= 0:
                    raise HTTPException(400, "Order inventory details are invalid")
                product = db.execute("SELECT id FROM products WHERE id=?", (product_id,)).fetchone()
                if not product:
                    raise HTTPException(400, "A product in this order no longer exists")
                db.execute(
                    "UPDATE products SET stock = stock + ? WHERE id=?",
                    (quantity, product_id),
                )

        elif not (
            user.get("role") == "owner"
            and user.get("name") == OWNER_NAME
            and user.get("email", "").lower() == OWNER_EMAIL
        ):
            raise HTTPException(403, "Owner access only")

        db.execute("UPDATE orders SET status=? WHERE id=?", (normalized_status, order_id))
        return {"message": "updated"}


@app.delete("/orders/{order_id}")
def delete_order(order_id: str, authorization: Optional[str] = Header(None)):
    require_owner(authorization)
    with get_db() as db:
        order = db.execute("SELECT status FROM orders WHERE id=?", (order_id,)).fetchone()
        if not order:
            raise HTTPException(404, "Order not found")
        if (order["status"] or "").lower() not in {"cancelled", "delivered"}:
            raise HTTPException(400, "Only cancelled or delivered orders can be deleted")
        db.execute("DELETE FROM orders WHERE id=?", (order_id,))
        return {"message": "deleted"}


@app.get("/")
def root():
    return {"message": "Kolkata Auto Center API is running. Visit /docs for interactive API docs."}


@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    return Response(status_code=204)
