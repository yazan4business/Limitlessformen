import { useState, useEffect, useRef, useMemo } from "react";
import {
  Menu, X, ShoppingBag, SlidersHorizontal, ChevronRight, ChevronLeft,
  Plus, Minus, Trash2, Check, Lock, LogOut, Package, ClipboardList,
  Star, Home as HomeIcon, User, Search, Upload, Pencil, MessageCircle, Instagram, Settings, Heart, MapPin
} from "lucide-react";

/* ---------------------------------------------------------------
   CONSTANTS & SEED DATA
---------------------------------------------------------------- */

// TODO: replace with the store's real WhatsApp number (country code, no + or spaces)
// and real Instagram username.
const WHATSAPP_NUMBER = "96171477317";
const INSTAGRAM_HANDLE = "limitless.for_men";

const DEFAULT_ADMIN_PASSWORD = "limitless2026";
const SHIPPING_FEE = 3;
const FREE_SHIPPING_THRESHOLD = 150;
const STATUSES = ["Pending", "Confirmed", "Preparing", "Shipped", "Delivered", "Cancelled"];
const ALL_SIZES = ["S", "M", "L", "XL", "XXL"];
const STYLES = ["Casual", "Smart Casual", "Streetwear", "Formal", "Athletic"];
const FABRICS = ["Cotton", "Cotton Blend", "Denim", "Fleece", "Polyester", "Leather", "Linen", "Wool"];

// Starting defaults only — categories & colors become editable from the admin dashboard
// and are stored in Firestore (settings/catalog) from then on.
const DEFAULT_CATEGORIES = ["Outerwear", "T-Shirts", "Knitwear", "Denim", "Bottoms", "Accessories"];
const DEFAULT_COLORS = [
  { name: "Black", hex: "#0a0a0a" },
  { name: "White", hex: "#f5f5f5" },
  { name: "Charcoal", hex: "#3a3a3a" },
  { name: "Stone", hex: "#a8a29e" },
  { name: "Olive", hex: "#5b5f43" },
  { name: "Indigo", hex: "#2c3550" },
  { name: "Grey", hex: "#87867f" },
];
function hexMapFrom(colors) {
  const m = {};
  (colors || []).forEach((c) => { m[c.name] = c.hex; });
  return m;
}

/* ---------------------------------------------------------------
   FIREBASE / FIRESTORE (REST API — no SDK needed)
---------------------------------------------------------------- */

const firebaseConfig = {
  apiKey: "AIzaSyDOt49i3EXvjpgPH_hM0jpTMz5salvj27Q",
  authDomain: "limitless-for-men-b5452.firebaseapp.com",
  projectId: "limitless-for-men-b5452",
  storageBucket: "limitless-for-men-b5452.firebasestorage.app",
  messagingSenderId: "274945042632",
  appId: "1:274945042632:web:b4e8f573a602080ee8ddfd",
};

const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents`;

function toFirestoreValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFirestoreValue) } };
  if (typeof v === "object") return { mapValue: { fields: toFirestoreFields(v) } };
  return { stringValue: String(v) };
}
function toFirestoreFields(obj) {
  const fields = {};
  Object.keys(obj || {}).forEach((k) => { fields[k] = toFirestoreValue(obj[k]); });
  return fields;
}
function fromFirestoreValue(v) {
  if (!v) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return parseInt(v.integerValue, 10);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(fromFirestoreValue);
  if ("mapValue" in v) return fromFirestoreFields(v.mapValue.fields || {});
  return null;
}
function fromFirestoreFields(fields) {
  const obj = {};
  Object.keys(fields || {}).forEach((k) => { obj[k] = fromFirestoreValue(fields[k]); });
  return obj;
}

async function fsListCollection(collection) {
  try {
    const res = await fetch(`${FIRESTORE_BASE}/${collection}?pageSize=300`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.documents) return [];
    return data.documents.map((doc) => {
      const id = doc.name.split("/").pop();
      return { id, ...fromFirestoreFields(doc.fields) };
    });
  } catch (e) {
    return null;
  }
}
async function fsGetDoc(collection, id) {
  try {
    const res = await fetch(`${FIRESTORE_BASE}/${collection}/${id}`);
    if (!res.ok) return null;
    const doc = await res.json();
    return fromFirestoreFields(doc.fields || {});
  } catch (e) {
    return null;
  }
}
async function fsSetDoc(collection, id, data) {
  try {
    const res = await fetch(`${FIRESTORE_BASE}/${collection}/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields: toFirestoreFields(data) }),
    });
    return res.ok;
  } catch (e) {
    return false;
  }
}
async function fsDeleteDoc(collection, id) {
  try {
    const res = await fetch(`${FIRESTORE_BASE}/${collection}/${encodeURIComponent(id)}`, { method: "DELETE" });
    return res.ok;
  } catch (e) {
    return false;
  }
}

const img = (seed) => `https://picsum.photos/seed/limitless-${seed}/900/1150?grayscale`;

function makeVariants(sizes, colors, qty) {
  const variants = [];
  sizes.forEach((size) => {
    colors.forEach((color) => {
      variants.push({ size, color, stock: qty });
    });
  });
  return variants;
}
function totalStock(product) {
  if (Array.isArray(product.variants) && product.variants.length > 0) {
    return product.variants.reduce((a, v) => a + (v.stock || 0), 0);
  }
  return product.stock || 0;
}
function findVariant(product, size, color) {
  if (!Array.isArray(product.variants)) return null;
  return product.variants.find((v) => v.size === size && v.color === color) || null;
}

function resizeImageFile(file, maxW = 900, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement("canvas");
        const scale = Math.min(1, maxW / image.width);
        canvas.width = image.width * scale;
        canvas.height = image.height * scale;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      image.onerror = reject;
      image.src = ev.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const now = Date.now();
const SEED_PRODUCTS = [
  { id: "p1", name: "Structured Bomber Jacket", category: "Outerwear", price: 189, compareAtPrice: null, styles: ["Streetwear", "Smart Casual"], fabric: "Technical Twill", description: "A precision-cut bomber in technical twill. Built with a stand collar and clean seams for a silhouette that holds its shape.", sizes: ["S","M","L","XL","XXL"], colors: ["Black","Charcoal"], variants: makeVariants(["S","M","L","XL","XXL"], ["Black","Charcoal"], 2), images: [img("p1a"), img("p1b"), img("p1c")], isNew: true, isFeatured: true, isBestSeller: true, isSoldOut: false, createdAt: now - 1000 },
  { id: "p2", name: "Essential Crew Tee", category: "T-Shirts", price: 45, compareAtPrice: null, styles: ["Casual", "Streetwear"], fabric: "100% Cotton", description: "Heavyweight cotton crewneck with a boxy, modern fit. The foundation piece of the collection.", sizes: ["S","M","L","XL","XXL"], colors: ["Black","White","Stone"], variants: makeVariants(["S","M","L","XL","XXL"], ["Black","White","Stone"], 4), images: [img("p2a"), img("p2b")], isNew: false, isFeatured: true, isBestSeller: true, isSoldOut: false, createdAt: now - 9000 },
  { id: "p3", name: "Tapered Cargo Pants", category: "Bottoms", price: 89, compareAtPrice: 110, styles: ["Streetwear", "Casual"], fabric: "Cotton Ripstop", description: "Utility-inspired cargo pants tapered through the leg. Reinforced pockets, matte hardware.", sizes: ["S","M","L","XL","XXL"], colors: ["Black","Olive"], variants: makeVariants(["S","M","L","XL","XXL"], ["Black","Olive"], 2), images: [img("p3a"), img("p3b"), img("p3c")], isNew: true, isFeatured: false, isBestSeller: false, isSoldOut: false, createdAt: now - 2000 },
  { id: "p4", name: "Heavyweight Hoodie", category: "Knitwear", price: 95, compareAtPrice: null, styles: ["Casual", "Streetwear", "Athletic"], fabric: "420gsm Brushed Fleece", description: "420gsm brushed fleece hoodie with a dropped shoulder and oversized kangaroo pocket.", sizes: ["S","M","L","XL","XXL"], colors: ["Black","Grey"], variants: makeVariants(["S","M","L","XL","XXL"], ["Black","Grey"], 3), images: [img("p4a"), img("p4b")], isNew: false, isFeatured: true, isBestSeller: true, isSoldOut: false, createdAt: now - 8000 },
  { id: "p5", name: "Slim Selvedge Denim", category: "Denim", price: 135, compareAtPrice: null, styles: ["Smart Casual", "Casual"], fabric: "Japanese Selvedge Denim", description: "Japanese selvedge denim in a slim, tapered leg. Raw hem, engineered to break in with wear.", sizes: ["S","M","L","XL"], colors: ["Black","Indigo"], variants: makeVariants(["S","M","L","XL"], ["Black","Indigo"], 2), images: [img("p5a"), img("p5b")], isNew: false, isFeatured: false, isBestSeller: false, isSoldOut: false, createdAt: now - 7000 },
  { id: "p6", name: "Technical Overshirt", category: "Outerwear", price: 119, compareAtPrice: 150, styles: ["Smart Casual", "Streetwear"], fabric: "Water-Resistant Shell", description: "A layer between shirt and jacket. Water-resistant shell with a soft brushed interior.", sizes: ["S","M","L","XL","XXL"], colors: ["Charcoal","Black"], variants: makeVariants(["S","M","L","XL","XXL"], ["Charcoal","Black"], 2), images: [img("p6a"), img("p6b"), img("p6c")], isNew: true, isFeatured: true, isBestSeller: false, isSoldOut: false, createdAt: now - 500 },
  { id: "p7", name: "Ribbed Knit Polo", category: "T-Shirts", price: 65, compareAtPrice: null, styles: ["Smart Casual", "Formal"], fabric: "Ribbed Cotton", description: "Fine-gauge ribbed polo with a clean placket. Sits close to the body without restriction.", sizes: ["S","M","L","XL"], colors: ["White","Black"], variants: makeVariants(["S","M","L","XL"], ["White","Black"], 3), images: [img("p7a"), img("p7b")], isNew: false, isFeatured: false, isBestSeller: false, isSoldOut: false, createdAt: now - 6000 },
  { id: "p8", name: "Woven Leather Belt", category: "Accessories", price: 55, compareAtPrice: null, styles: ["Formal", "Smart Casual"], fabric: "Full-Grain Leather", description: "Full-grain leather belt with a matte black geometric buckle.", sizes: ["One Size"], colors: ["Black"], variants: makeVariants(["One Size"], ["Black"], 35), images: [img("p8a")], isNew: false, isFeatured: false, isBestSeller: false, isSoldOut: false, createdAt: now - 5000 },
];

const onSale = (p) => p.compareAtPrice && p.compareAtPrice > p.price;

const fmt = (n) => `$${Number(n).toFixed(2)}`;
const genId = () => "p" + Math.random().toString(36).slice(2, 9);
const genOrderId = () => "LFM-" + Date.now().toString(36).toUpperCase();

function buildWhatsAppMessage(order) {
  const lines = [];
  lines.push(`طلب جديد من موقع LIMITLESS FOR MEN`);
  lines.push(`رقم الطلب: ${order.id}`);
  lines.push("");
  lines.push("المنتجات:");
  order.items.forEach((it) => {
    lines.push(`- ${it.name} (${it.color} / ${it.size}) × ${it.qty} — ${fmt(it.price * it.qty)}`);
  });
  lines.push("");
  lines.push(`الشحن: ${order.shipping === 0 ? "مجاني" : fmt(order.shipping)}`);
  lines.push(`الإجمالي: ${fmt(order.total)}`);
  lines.push("");
  lines.push(`الاسم: ${order.customer.fullName}`);
  lines.push(`الهاتف: ${order.customer.phone}`);
  lines.push(`العنوان: ${order.customer.address}, ${order.customer.city}`);
  if (order.customer.notes) lines.push(`ملاحظات: ${order.customer.notes}`);
  lines.push("");
  lines.push(`شكراً إلك ❤️ عم نجهز طلبك بأسرع وقت.`);
  return encodeURIComponent(lines.join("\n"));
}

function whatsappLink(message = "") {
  return `https://wa.me/${WHATSAPP_NUMBER}${message ? `?text=${message}` : ""}`;
}
function instagramLink() {
  return `https://instagram.com/${INSTAGRAM_HANDLE}`;
}

/* ---------------------------------------------------------------
   REVEAL ON SCROLL
---------------------------------------------------------------- */

function Reveal({ children, className = "", delay = 0 }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            setVisible(true);
            obs.unobserve(el);
          }
        });
      },
      { threshold: 0.15 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(28px)",
        transition: `opacity 0.7s ease ${delay}ms, transform 0.7s ease ${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------
   LOGO
---------------------------------------------------------------- */

function Logo({ size = "nav", light = true }) {
  const scale = size === "hero" ? 1 : size === "footer" ? 0.8 : 0.42;
  const color = light ? "#f5f5f5" : "#0a0a0a";
  return (
    <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", lineHeight: 1 }}>
      <div
        className="font-display"
        style={{
          fontSize: `${scale * 3.2}rem`,
          fontWeight: 400,
          letterSpacing: `${scale * 0.14}em`,
          color,
          position: "relative",
          whiteSpace: "nowrap",
        }}
      >
        LIMITLESS
        <span
          style={{
            position: "absolute",
            left: "8%",
            right: "8%",
            top: "50%",
            height: 1,
            background: color,
            opacity: 0.5,
          }}
        />
      </div>
      <div
        className="font-display"
        style={{
          fontSize: `${scale * 0.95}rem`,
          fontWeight: 400,
          letterSpacing: `${scale * 0.5}em`,
          color,
          marginTop: `${scale * 0.35}rem`,
          opacity: 0.85,
        }}
      >
        FOR MEN
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   APP
---------------------------------------------------------------- */

export default function App() {
  const [page, setPage] = useState("home");
  const [selectedId, setSelectedId] = useState(null);
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [cart, setCart] = useState([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [cartBounce, setCartBounce] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminPassword, setAdminPassword] = useState(DEFAULT_ADMIN_PASSWORD);
  const [lastOrder, setLastOrder] = useState(null);
  const [shopFilter, setShopFilter] = useState(null); // preset category from home
  const [styleFilter, setStyleFilter] = useState(null); // preset style from home
  const [scrolled, setScrolled] = useState(false);
  const [wishlist, setWishlist] = useState([]);
  const [wishlistBounce, setWishlistBounce] = useState(false);
  const [styleImages, setStyleImages] = useState({});
  const [catImages, setCatImages] = useState({});
  const [firestoreError, setFirestoreError] = useState(false);
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
  const [colors, setColors] = useState(DEFAULT_COLORS);

  useEffect(() => {
    (async () => {
      let p = await fsListCollection("products");
      if (p === null) {
        setFirestoreError(true);
        p = SEED_PRODUCTS;
      } else if (p.length === 0) {
        await Promise.all(SEED_PRODUCTS.map((prod) => fsSetDoc("products", prod.id, prod)));
        p = SEED_PRODUCTS;
      }

      let o = await fsListCollection("orders");
      if (o === null) { setFirestoreError(true); o = []; }
      o.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

      let settings = await fsGetDoc("settings", "admin");
      let pw = settings && settings.password ? settings.password : null;
      if (!pw) {
        await fsSetDoc("settings", "admin", { password: DEFAULT_ADMIN_PASSWORD });
        pw = DEFAULT_ADMIN_PASSWORD;
      }

      let styleImgDoc = await fsGetDoc("settings", "style-images");
      const si = styleImgDoc ? styleImgDoc.map : null;

      let catImgDoc = await fsGetDoc("settings", "cat-images");
      const ci = catImgDoc ? catImgDoc.map : null;

      let catalogDoc = await fsGetDoc("settings", "catalog");
      let cats = catalogDoc && catalogDoc.categories ? catalogDoc.categories : null;
      let cols = catalogDoc && catalogDoc.colors ? catalogDoc.colors : null;
      if (!cats || !cols) {
        cats = cats || DEFAULT_CATEGORIES;
        cols = cols || DEFAULT_COLORS;
        await fsSetDoc("settings", "catalog", { categories: cats, colors: cols });
      }

      setProducts(p);
      setOrders(o);
      setCategories(cats);
      setColors(cols);
      // Wishlist is personal to each visitor's session — it isn't written to
      // the shared Firestore store, so it starts empty each visit for now.
      try { setStyleImages(si ? JSON.parse(si) : {}); } catch { setStyleImages({}); }
      try { setCatImages(ci ? JSON.parse(ci) : {}); } catch { setCatImages({}); }
      setAdminPassword(pw);
      setDataLoaded(true);
    })();
  }, []);

  async function persistAdminPassword(newPassword) {
    setAdminPassword(newPassword);
    await fsSetDoc("settings", "admin", { password: newPassword });
  }

  async function persistStyleImages(next) {
    setStyleImages(next);
    await fsSetDoc("settings", "style-images", { map: JSON.stringify(next) });
  }

  async function persistCatImages(next) {
    setCatImages(next);
    await fsSetDoc("settings", "cat-images", { map: JSON.stringify(next) });
  }

  async function persistCatalog(nextCategories, nextColors) {
    setCategories(nextCategories);
    setColors(nextColors);
    await fsSetDoc("settings", "catalog", { categories: nextCategories, colors: nextColors });
  }

  function toggleWishlist(productId) {
    setWishlist((prev) =>
      prev.includes(productId) ? prev.filter((id) => id !== productId) : [...prev, productId]
    );
    setWishlistBounce(true);
    setTimeout(() => setWishlistBounce(false), 500);
  }

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const titles = {
      home: "LIMITLESS FOR MEN",
      shop: "Shop | LIMITLESS FOR MEN",
      product: "LIMITLESS FOR MEN",
      wishlist: "Wishlist | LIMITLESS FOR MEN",
      about: "About | LIMITLESS FOR MEN",
      checkout: "Checkout | LIMITLESS FOR MEN",
      confirmation: "Order Confirmed | LIMITLESS FOR MEN",
      "admin-login": "Admin Login | LIMITLESS FOR MEN",
      admin: "Admin Dashboard | LIMITLESS FOR MEN",
    };
    document.title = titles[page] || "LIMITLESS FOR MEN";
  }, [page]);

  useEffect(() => {
    function onKeyDown(e) {
      if (e.ctrlKey && e.shiftKey && (e.key === "A" || e.key === "a")) {
        e.preventDefault();
        navigate("admin-login");
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const navigate = (p, params = {}) => {
    setMenuOpen(false);
    setCartOpen(false);
    if (params.productId) setSelectedId(params.productId);
    if (params.category !== undefined) setShopFilter(params.category);
    if (params.style !== undefined) setStyleFilter(params.style);
    setPage(p);
    window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
  };

  async function persistProducts(next) {
    const prevIds = products.map((p) => p.id);
    const nextIds = next.map((p) => p.id);
    setProducts(next);
    const removed = prevIds.filter((id) => !nextIds.includes(id));
    await Promise.all([
      ...next.map((p) => fsSetDoc("products", p.id, p)),
      ...removed.map((id) => fsDeleteDoc("products", id)),
    ]);
  }
  async function persistOrders(next) {
    const prevIds = orders.map((o) => o.id);
    const nextIds = next.map((o) => o.id);
    setOrders(next);
    const removed = prevIds.filter((id) => !nextIds.includes(id));
    await Promise.all([
      ...next.map((o) => fsSetDoc("orders", o.id, o)),
      ...removed.map((id) => fsDeleteDoc("orders", id)),
    ]);
  }

  const cartCount = cart.reduce((a, c) => a + c.qty, 0);
  const cartSubtotal = cart.reduce((a, c) => a + c.price * c.qty, 0);
  const cartShipping = cart.length === 0 ? 0 : SHIPPING_FEE;
  const cartTotal = cartSubtotal + cartShipping;

  function addToCart(product, size, color, qty) {
    const key = `${product.id}-${size}-${color}`;
    setCart((prev) => {
      const existing = prev.find((c) => c.key === key);
      if (existing) {
        return prev.map((c) => (c.key === key ? { ...c, qty: c.qty + qty } : c));
      }
      return [
        ...prev,
        { key, productId: product.id, name: product.name, price: product.price, image: product.images[0], size, color, qty },
      ];
    });
    setCartBounce(true);
    setTimeout(() => setCartBounce(false), 500);
    setCartOpen(true);
  }
  function updateCartQty(key, delta) {
    setCart((prev) =>
      prev
        .map((c) => (c.key === key ? { ...c, qty: Math.max(1, c.qty + delta) } : c))
        .filter((c) => c.qty > 0)
    );
  }
  function removeFromCart(key) {
    setCart((prev) => prev.filter((c) => c.key !== key));
  }

  async function placeOrder(form) {
    const order = {
      id: genOrderId(),
      createdAt: Date.now(),
      customer: form,
      items: cart,
      subtotal: cartSubtotal,
      shipping: cartShipping,
      total: cartTotal,
      status: "Pending",
    };

    // Open WhatsApp immediately, synchronously, as a direct result of the click —
    // browsers block window.open() if it happens after an `await`, so this must
    // run first, before any async storage calls.
    window.open(whatsappLink(buildWhatsAppMessage(order)), "_blank");

    setLastOrder(order);
    setCart([]);
    navigate("confirmation");

    const nextOrders = [order, ...orders];
    await persistOrders(nextOrders);

    const nextProducts = products.map((p) => {
      const cartLinesForProduct = cart.filter((c) => c.productId === p.id);
      if (cartLinesForProduct.length === 0) return p;
      if (Array.isArray(p.variants) && p.variants.length > 0) {
        const nextVariants = p.variants.map((v) => {
          const line = cartLinesForProduct.find((c) => c.size === v.size && c.color === v.color);
          return line ? { ...v, stock: Math.max(0, v.stock - line.qty) } : v;
        });
        return { ...p, variants: nextVariants };
      }
      const ordered = cartLinesForProduct.reduce((a, c) => a + c.qty, 0);
      return { ...p, stock: Math.max(0, (p.stock || 0) - ordered) };
    });
    await persistProducts(nextProducts);
  }

  if (!dataLoaded) {
    return (
      <div style={{ minHeight: "100vh", background: "#000" }} className="flex items-center justify-center">
        <GlobalStyle />
        <Logo size="hero" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-neutral-100 font-body" style={{ paddingBottom: 64 }}>
      <GlobalStyle />
      {firestoreError && (
        <div className="bg-white text-black text-xs text-center py-2 px-4">
          Couldn't reach the database — showing local demo data. Changes won't be saved. Check Firestore is enabled and its Security Rules allow access.
        </div>
      )}
      <Nav
        cartCount={cartCount}
        cartBounce={cartBounce}
        wishlistCount={wishlist.length}
        wishlistBounce={wishlistBounce}
        onNavigate={navigate}
        menuOpen={menuOpen}
        setMenuOpen={setMenuOpen}
        setCartOpen={setCartOpen}
        scrolled={scrolled}
        page={page}
        onOpenSearch={() => setSearchOpen(true)}
      />

      {page === "home" && (
        <HomePage
          products={products}
          onNavigate={navigate}
          onAddToCart={addToCart}
          wishlist={wishlist}
          onToggleWishlist={toggleWishlist}
          styleImages={styleImages}
          catImages={catImages}
          categories={categories}
          colors={colors}
        />
      )}
      {page === "shop" && (
        <ShopPage
          products={products}
          initialCategory={shopFilter}
          initialStyle={styleFilter}
          onNavigate={navigate}
          onAddToCart={addToCart}
          wishlist={wishlist}
          onToggleWishlist={toggleWishlist}
          categories={categories}
          colors={colors}
        />
      )}
      {page === "product" && (
        <ProductDetailPage
          product={products.find((p) => p.id === selectedId)}
          products={products}
          onNavigate={navigate}
          onAddToCart={addToCart}
          wishlist={wishlist}
          onToggleWishlist={toggleWishlist}
          colors={colors}
        />
      )}
      {page === "wishlist" && (
        <WishlistPage
          products={products}
          wishlist={wishlist}
          onToggleWishlist={toggleWishlist}
          onNavigate={navigate}
          onAddToCart={addToCart}
          colors={colors}
        />
      )}
      {page === "about" && <AboutPage onNavigate={navigate} />}
      {page === "checkout" && (
        <CheckoutPage
          cart={cart}
          subtotal={cartSubtotal}
          shipping={cartShipping}
          total={cartTotal}
          onNavigate={navigate}
          onPlaceOrder={placeOrder}
        />
      )}
      {page === "confirmation" && <ConfirmationPage order={lastOrder} onNavigate={navigate} />}
      {page === "admin-login" && (
        <AdminLoginPage
          adminPassword={adminPassword}
          onSuccess={() => {
            setIsAdmin(true);
            navigate("admin");
          }}
        />
      )}
      {page === "admin" &&
        (isAdmin ? (
          <AdminDashboard
            products={products}
            orders={orders}
            onSaveProducts={persistProducts}
            onSaveOrders={persistOrders}
            adminPassword={adminPassword}
            onChangePassword={persistAdminPassword}
            styleImages={styleImages}
            onSaveStyleImages={persistStyleImages}
            catImages={catImages}
            onSaveCatImages={persistCatImages}
            categories={categories}
            colors={colors}
            onSaveCatalog={persistCatalog}
            onLogout={() => {
              setIsAdmin(false);
              navigate("home");
            }}
          />
        ) : (
          <AdminLoginPage
            adminPassword={adminPassword}
            onSuccess={() => setIsAdmin(true)}
          />
        ))}

      <Footer onNavigate={navigate} />

      <MobileBottomNav
        page={page}
        onNavigate={navigate}
        cartCount={cartCount}
        cartBounce={cartBounce}
        wishlistCount={wishlist.length}
        wishlistBounce={wishlistBounce}
        setCartOpen={setCartOpen}
        onOpenSearch={() => setSearchOpen(true)}
      />

      <SearchOverlay
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        products={products}
        categories={categories}
        colors={colors}
        onNavigate={(p, params) => { setSearchOpen(false); navigate(p, params); }}
        onAddToCart={addToCart}
        wishlist={wishlist}
        onToggleWishlist={toggleWishlist}
      />

      <a
        href={whatsappLink("مرحباً، عندي استفسار عن منتجاتكم.")}
        target="_blank"
        rel="noopener noreferrer"
        className="fixed z-40 bg-white text-black w-12 h-12 rounded-full flex items-center justify-center shadow-lg hover-lift pulse-ring tap-scale"
        style={{ right: 16, bottom: cartOpen ? -100 : 84 }}
        aria-label="Chat on WhatsApp"
      >
        <MessageCircle size={22} />
      </a>

      <CartDrawer
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        cart={cart}
        subtotal={cartSubtotal}
        shipping={cartShipping}
        total={cartTotal}
        onUpdateQty={updateCartQty}
        onRemove={removeFromCart}
        onNavigate={navigate}
      />
    </div>
  );
}

/* ---------------------------------------------------------------
   GLOBAL STYLE
---------------------------------------------------------------- */

function GlobalStyle() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;500;600&family=Inter:wght@300;400;500;600;700&display=swap');
      .font-display { font-family: 'Orbitron', sans-serif; }
      .font-body { font-family: 'Inter', sans-serif; }
      * { -webkit-tap-highlight-color: transparent; }
      html { scroll-behavior: smooth; }
      body { background:#000; }
      .glass { background: rgba(255,255,255,0.04); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); border: 1px solid rgba(255,255,255,0.08); }
      .glass-strong { background: rgba(10,10,10,0.75); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); }
      .btn-shine { position: relative; overflow: hidden; }
      .btn-shine::after {
        content: ""; position: absolute; top:0; left:-75%; width: 50%; height: 100%;
        background: linear-gradient(120deg, transparent, rgba(255,255,255,0.35), transparent);
        transform: skewX(-20deg);
        transition: left 0.6s ease;
      }
      .btn-shine:hover::after { left: 125%; }
      .hover-lift { transition: transform 0.35s cubic-bezier(.2,.8,.2,1), box-shadow 0.35s ease; }
      .hover-lift:hover { transform: translateY(-4px); }
      .img-zoom { overflow: hidden; }
      .img-zoom img { transition: transform 0.6s ease, opacity 0.3s ease; }
      .img-zoom:hover img { transform: scale(1.06); }
      ::-webkit-scrollbar { width: 8px; height: 8px; }
      ::-webkit-scrollbar-track { background: #0a0a0a; }
      ::-webkit-scrollbar-thumb { background: #333; border-radius: 4px; }
      @keyframes fadeIn { from { opacity:0 } to { opacity:1 } }
      .fade-in { animation: fadeIn 0.4s ease; }
      @keyframes slideInRight { from { transform: translateX(100%) } to { transform: translateX(0) } }
      .slide-in-right { animation: slideInRight 0.35s cubic-bezier(.2,.8,.2,1); }
      @keyframes sheetUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
      .sheet-up { animation: sheetUp 0.4s cubic-bezier(.16,1,.3,1); }
      @keyframes pulseRing { 0% { box-shadow: 0 0 0 0 rgba(255,255,255,0.25); } 100% { box-shadow: 0 0 0 10px rgba(255,255,255,0); } }
      .pulse-ring { animation: pulseRing 1.6s ease-out infinite; }
      .tap-scale { transition: transform 0.15s cubic-bezier(.4,0,.2,1); }
      .tap-scale:active { transform: scale(0.8); }
      @keyframes iconPop {
        0% { transform: scale(1); }
        35% { transform: scale(1.4) rotate(-6deg); }
        60% { transform: scale(0.9) rotate(3deg); }
        100% { transform: scale(1) rotate(0deg); }
      }
      .icon-pop { animation: iconPop 0.5s cubic-bezier(.34,1.56,.64,1); }
      @keyframes badgePop {
        0% { transform: scale(0); }
        70% { transform: scale(1.3); }
        100% { transform: scale(1); }
      }
      .badge-pop { animation: badgePop 0.35s cubic-bezier(.34,1.56,.64,1); }
      input:focus, select:focus, textarea:focus, button:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
      @media (prefers-reduced-motion: reduce) {
        * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
      }
    `}</style>
  );
}

/* ---------------------------------------------------------------
   NAV
---------------------------------------------------------------- */

function Nav({ cartCount, cartBounce, wishlistCount, wishlistBounce, onNavigate, menuOpen, setMenuOpen, setCartOpen, scrolled, page, onOpenSearch }) {
  const links = [
    { label: "Home", page: "home" },
    { label: "Shop", page: "shop" },
    { label: "About", page: "about" },
  ];
  return (
    <>
      <header
        className={`sticky top-0 z-40 transition-all duration-300 ${scrolled ? "glass-strong border-b border-neutral-800" : "bg-transparent"}`}
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex items-center justify-between" style={{ height: 64 }}>
          <button onClick={() => setMenuOpen(true)} className="md:hidden p-2 -ml-2 tap-scale" aria-label="Open menu">
            <Menu size={22} />
          </button>

          <button onClick={() => onNavigate("home")} className="flex-shrink-0 tap-scale">
            <Logo size="nav" />
          </button>

          <nav className="hidden md:flex items-center gap-8 font-body text-sm tracking-wide uppercase">
            {links.map((l) => (
              <button
                key={l.page}
                onClick={() => onNavigate(l.page)}
                className={`transition-colors hover:text-white tap-scale ${page === l.page ? "text-white" : "text-neutral-400"}`}
                style={{ letterSpacing: "0.08em" }}
              >
                {l.label}
              </button>
            ))}
          </nav>

          <div className="flex items-center gap-4">
            <button onClick={onOpenSearch} className="text-neutral-400 hover:text-white transition-colors tap-scale" aria-label="Search">
              <Search size={19} />
            </button>
            <a href={instagramLink()} target="_blank" rel="noopener noreferrer" className="hidden md:block text-neutral-400 hover:text-white transition-colors tap-scale" aria-label="Instagram">
              <Instagram size={18} />
            </a>
            <a href={whatsappLink()} target="_blank" rel="noopener noreferrer" className="hidden md:block text-neutral-400 hover:text-white transition-colors tap-scale" aria-label="WhatsApp">
              <MessageCircle size={18} />
            </a>
            <button onClick={() => onNavigate("wishlist")} className="relative p-2 -mr-1 tap-scale" aria-label="Wishlist">
              <Heart size={20} className={wishlistBounce ? "icon-pop" : ""} />
              {wishlistCount > 0 && (
                <span className={`absolute -top-0.5 -right-0.5 bg-white text-black text-xs w-4 h-4 rounded-full flex items-center justify-center font-semibold ${wishlistBounce ? "badge-pop" : ""}`}>
                  {wishlistCount}
                </span>
              )}
            </button>
            <button onClick={() => setCartOpen(true)} className="relative p-2 -mr-2 tap-scale" aria-label="Cart">
              <ShoppingBag size={22} className={cartBounce ? "icon-pop" : ""} />
              {cartCount > 0 && (
                <span className={`absolute -top-0.5 -right-0.5 bg-white text-black text-xs w-4 h-4 rounded-full flex items-center justify-center font-semibold ${cartBounce ? "badge-pop" : ""}`}>
                  {cartCount}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Mobile menu overlay */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 md:hidden fade-in">
          <div className="absolute inset-0 bg-black" style={{ opacity: 0.97 }} />
          <div className="relative h-full flex flex-col px-6 py-6">
            <div className="flex items-center justify-between">
              <Logo size="nav" />
              <button onClick={() => setMenuOpen(false)} aria-label="Close menu" className="p-2 tap-scale">
                <X size={24} />
              </button>
            </div>
            <div className="flex-1 flex flex-col justify-center gap-8 font-display text-3xl">
              <button onClick={() => onNavigate("home")} className="text-left tap-scale">HOME</button>
              <button onClick={() => onNavigate("shop")} className="text-left tap-scale">SHOP</button>
              <button onClick={() => onNavigate("wishlist")} className="text-left tap-scale">WISHLIST</button>
              <button onClick={() => onNavigate("about")} className="text-left tap-scale">ABOUT</button>
            </div>
            <div className="flex items-center gap-6 mb-4">
              <a href={whatsappLink()} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-neutral-300 tap-scale">
                <MessageCircle size={18} /> WhatsApp
              </a>
              <a href={instagramLink()} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-neutral-300 tap-scale">
                <Instagram size={18} /> Instagram
              </a>
            </div>
            <p className="text-neutral-500 text-xs uppercase tracking-widest">Limitless For Men &copy; {new Date().getFullYear()}</p>
          </div>
        </div>
      )}
    </>
  );
}

function MobileBottomNav({ page, onNavigate, cartCount, cartBounce, wishlistCount, wishlistBounce, setCartOpen, onOpenSearch }) {
  const Item = ({ icon, label, active, onClick }) => (
    <button onClick={onClick} className="flex flex-col items-center justify-center gap-1 flex-1 py-2.5 tap-scale" style={{ color: active ? "#fff" : "#7a7a7a" }}>
      {icon}
      <span className="text-xs" style={{ letterSpacing: "0.03em" }}>{label}</span>
    </button>
  );
  return (
    <div className="md:hidden fixed bottom-0 left-0 right-0 z-30 glass-strong border-t border-neutral-800">
      <div className="flex items-stretch max-w-6xl mx-auto">
        <Item icon={<HomeIcon size={20} />} label="Home" active={page === "home"} onClick={() => onNavigate("home")} />
        <Item
          icon={
            <span className="relative">
              <Heart size={20} className={wishlistBounce ? "icon-pop" : ""} />
              {wishlistCount > 0 && (
                <span className={`absolute -top-1.5 -right-2 bg-white text-black text-[10px] w-4 h-4 rounded-full flex items-center justify-center font-semibold ${wishlistBounce ? "badge-pop" : ""}`}>
                  {wishlistCount}
                </span>
              )}
            </span>
          }
          label="Wishlist"
          active={page === "wishlist"}
          onClick={() => onNavigate("wishlist")}
        />
        <Item
          icon={
            <span className="relative">
              <ShoppingBag size={20} className={cartBounce ? "icon-pop" : ""} />
              {cartCount > 0 && (
                <span className={`absolute -top-1.5 -right-2 bg-white text-black text-[10px] w-4 h-4 rounded-full flex items-center justify-center font-semibold ${cartBounce ? "badge-pop" : ""}`}>
                  {cartCount}
                </span>
              )}
            </span>
          }
          label="Cart"
          active={false}
          onClick={() => setCartOpen(true)}
        />
        <Item icon={<Search size={20} />} label="Search" active={false} onClick={onOpenSearch} />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   HOME PAGE
---------------------------------------------------------------- */

function HomePage({ products, onNavigate, onAddToCart, wishlist, onToggleWishlist, categories, colors, styleImages = {}, catImages = {} }) {
  const featured = products.filter((p) => p.isFeatured).slice(0, 4);
  const newArrivals = products.filter((p) => p.isNew).slice(0, 4);
  const bestSellers = products.filter((p) => p.isBestSeller).slice(0, 4);

  return (
    <div>
      {/* HERO */}
      <section className="relative flex flex-col items-center justify-center text-center px-6 overflow-hidden" style={{ minHeight: "92vh" }}>
        <div
          className="absolute inset-0"
          style={{
            background: "radial-gradient(circle at 50% 30%, rgba(255,255,255,0.06), transparent 60%)",
          }}
        />
        <div className="relative fade-in">
          <Logo size="hero" />
        </div>
        <Reveal delay={150}>
          <h1 className="font-display mt-10 text-4xl sm:text-6xl md:text-7xl tracking-tight leading-none">
            NEXT LEVEL<br />STARTS HERE ♟️
          </h1>
        </Reveal>
        <Reveal delay={300}>
          <p className="mt-6 text-neutral-400 max-w-md mx-auto text-base sm:text-lg font-light">
            Premium men&rsquo;s fashion designed for those who never settle.
          </p>
        </Reveal>
        <Reveal delay={450}>
          <button
            onClick={() => onNavigate("shop")}
            className="btn-shine mt-10 bg-white text-black px-10 py-4 uppercase tracking-widest text-sm font-semibold flex items-center gap-2 hover-lift"
          >
            Shop Now <ChevronRight size={16} />
          </button>
        </Reveal>
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 text-neutral-600 text-xs uppercase tracking-widest">Scroll</div>
      </section>

      {/* STYLES — find your look */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-20 border-t border-neutral-900">
        <Reveal>
          <div className="text-center mb-10">
            <span className="text-xs uppercase tracking-widest text-neutral-500">Dress for the moment</span>
            <h2 className="font-display text-3xl sm:text-4xl mt-2 tracking-wide">Find Your Look</h2>
            <p className="text-neutral-400 text-sm mt-3 max-w-md mx-auto">Every piece organized by how you actually dress — not just what it's called.</p>
          </div>
        </Reveal>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 sm:gap-4">
          {STYLES.map((s, i) => (
            <Reveal key={s} delay={i * 70}>
              <button
                onClick={() => onNavigate("shop", { style: s })}
                className="relative w-full block img-zoom hover-lift group"
                style={{ aspectRatio: "3/4" }}
              >
                <img src={styleImages[s] || img("style-" + s)} alt={s} className="w-full h-full object-cover" style={{ filter: "grayscale(1) contrast(1.1)" }} />
                <div className="absolute inset-0 bg-black" style={{ opacity: 0.4 }} />
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-3">
                  <span className="font-display text-white text-sm sm:text-base tracking-wide">{s}</span>
                  <span className="text-white text-xs mt-2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                    Shop <ChevronRight size={12} />
                  </span>
                </div>
              </button>
            </Reveal>
          ))}
        </div>
      </section>

      {/* CATEGORIES */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-20">
        <Reveal>
          <h2 className="font-display text-2xl sm:text-3xl mb-8 tracking-wide">Shop by Category</h2>
        </Reveal>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
          {(categories || DEFAULT_CATEGORIES).map((cat, i) => (
            <Reveal key={cat} delay={i * 60}>
              <button
                onClick={() => onNavigate("shop", { category: cat })}
                className="relative w-full block img-zoom hover-lift group"
                style={{ aspectRatio: "4/5" }}
              >
                <img src={catImages[cat] || img("cat-" + cat)} alt={cat} className="w-full h-full object-cover" style={{ filter: "grayscale(1) contrast(1.1)" }} />
                <div className="absolute inset-0 bg-black" style={{ opacity: 0.35 }} />
                <div className="absolute inset-0 flex items-end p-4">
                  <span className="font-display text-white text-sm sm:text-base tracking-wide">{cat}</span>
                </div>
              </button>
            </Reveal>
          ))}
        </div>
      </section>

      {/* FEATURED */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-16">
        <Reveal>
          <div className="flex items-end justify-between mb-8">
            <h2 className="font-display text-2xl sm:text-3xl tracking-wide">Featured</h2>
            <button onClick={() => onNavigate("shop")} className="text-sm text-neutral-400 hover:text-white flex items-center gap-1 uppercase tracking-wide">
              View all <ChevronRight size={14} />
            </button>
          </div>
        </Reveal>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-6">
          {featured.map((p, i) => (
            <Reveal key={p.id} delay={i * 80}>
              <ProductCard product={p} onNavigate={onNavigate} onAddToCart={onAddToCart} wishlist={wishlist} onToggleWishlist={onToggleWishlist} colors={colors} />
            </Reveal>
          ))}
        </div>
      </section>

      {/* BEST SELLERS */}
      {bestSellers.length > 0 && (
        <section className="max-w-6xl mx-auto px-4 sm:px-6 py-16">
          <Reveal>
            <div className="flex items-end justify-between mb-8">
              <h2 className="font-display text-2xl sm:text-3xl tracking-wide flex items-center gap-2">
                <Star size={20} className="fill-white" /> Best Sellers
              </h2>
              <button onClick={() => onNavigate("shop")} className="text-sm text-neutral-400 hover:text-white flex items-center gap-1 uppercase tracking-wide">
                View all <ChevronRight size={14} />
              </button>
            </div>
          </Reveal>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-6">
            {bestSellers.map((p, i) => (
              <Reveal key={p.id} delay={i * 80}>
                <ProductCard product={p} onNavigate={onNavigate} onAddToCart={onAddToCart} wishlist={wishlist} onToggleWishlist={onToggleWishlist} colors={colors} />
              </Reveal>
            ))}
          </div>
        </section>
      )}

      {/* NEW ARRIVALS */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-16">
        <Reveal>
          <div className="flex items-end justify-between mb-8">
            <h2 className="font-display text-2xl sm:text-3xl tracking-wide">New Arrivals</h2>
            <button onClick={() => onNavigate("shop")} className="text-sm text-neutral-400 hover:text-white flex items-center gap-1 uppercase tracking-wide">
              View all <ChevronRight size={14} />
            </button>
          </div>
        </Reveal>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-6">
          {newArrivals.map((p, i) => (
            <Reveal key={p.id} delay={i * 80}>
              <ProductCard product={p} onNavigate={onNavigate} onAddToCart={onAddToCart} wishlist={wishlist} onToggleWishlist={onToggleWishlist} colors={colors} />
            </Reveal>
          ))}
        </div>
      </section>

      {/* BRAND STATEMENT */}
      <section className="px-6 py-24 text-center border-t border-neutral-900">
        <Reveal>
          <p className="font-display text-xl sm:text-3xl max-w-2xl mx-auto leading-relaxed tracking-wide">
            NEXT LEVEL STARTS HERE ♟️
          </p>
        </Reveal>
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------
   PRODUCT CARD
---------------------------------------------------------------- */

function ProductCard({ product, onNavigate, onAddToCart, wishlist = [], onToggleWishlist, colors }) {
  const [hoverImg, setHoverImg] = useState(0);
  const outOfStock = totalStock(product) <= 0 || product.isSoldOut;
  const isWishlisted = wishlist.includes(product.id);
  const sale = onSale(product);
  const hexMap = hexMapFrom(colors && colors.length ? colors : DEFAULT_COLORS);
  return (
    <div className="group">
      <button
        onClick={() => onNavigate("product", { productId: product.id })}
        className="relative block w-full img-zoom bg-neutral-950"
        style={{ aspectRatio: "3/4" }}
        onMouseEnter={() => product.images[1] && setHoverImg(1)}
        onMouseLeave={() => setHoverImg(0)}
      >
        <img
          src={product.images[hoverImg] || product.images[0]}
          alt={product.name}
          className="w-full h-full object-cover"
          style={{ filter: "grayscale(1) contrast(1.05)" }}
        />
        {product.isNew ? (
          <span className="absolute top-2 left-2 bg-white text-black text-[10px] uppercase tracking-widest px-2 py-1 font-semibold">New</span>
        ) : sale ? (
          <span className="absolute top-2 left-2 bg-white text-black text-[10px] uppercase tracking-widest px-2 py-1 font-semibold">Sale</span>
        ) : product.isBestSeller ? (
          <span className="absolute top-2 left-2 bg-white text-black text-[10px] uppercase tracking-widest px-2 py-1 font-semibold flex items-center gap-1">
            <Star size={10} className="fill-black" /> Best Seller
          </span>
        ) : null}
        {onToggleWishlist && (
          <div
            onClick={(e) => { e.stopPropagation(); onToggleWishlist(product.id); }}
            role="button"
            aria-label="Toggle wishlist"
            className="absolute top-2 right-2 w-8 h-8 rounded-full flex items-center justify-center tap-scale"
            style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}
          >
            <Heart size={15} className={isWishlisted ? "fill-white" : ""} color="#fff" />
          </div>
        )}
        {outOfStock && (
          <div className="absolute inset-0 bg-black flex items-center justify-center" style={{ opacity: 0.6 }}>
            <span className="uppercase tracking-widest text-xs border border-white px-3 py-1">Sold Out</span>
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 p-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300 hidden sm:block">
          <div
            onClick={(e) => {
              e.stopPropagation();
              if (!outOfStock) onAddToCart(product, product.sizes[0], product.colors[0], 1);
            }}
            role="button"
            className="w-full bg-white text-black text-xs uppercase tracking-widest py-2.5 text-center font-semibold hover:bg-neutral-200 transition-colors"
          >
            {outOfStock ? "Unavailable" : "Quick Add"}
          </div>
        </div>
      </button>
      <button onClick={() => onNavigate("product", { productId: product.id })} className="block text-left mt-3 w-full">
        <p className="text-sm sm:text-base">{product.name}</p>
        <div className="flex items-center justify-between mt-1">
          <p className="text-sm flex items-center gap-2">
            <span className={sale ? "text-white" : "text-neutral-400"}>{fmt(product.price)}</span>
            {sale && <span className="text-neutral-600 line-through">{fmt(product.compareAtPrice)}</span>}
          </p>
          <div className="flex gap-1">
            {product.colors.slice(0, 4).map((c) => (
              <span key={c} title={c} className="w-3 h-3 rounded-full border border-neutral-700" style={{ background: hexMap[c] || "#888" }} />
            ))}
          </div>
        </div>
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------
   SHOP PAGE
---------------------------------------------------------------- */

function ShopPage({ products, initialCategory, initialStyle, onNavigate, onAddToCart, wishlist, onToggleWishlist, categories, colors }) {
  const [categoryFilter, setCategoryFilter] = useState(initialCategory ? [initialCategory] : []);
  const [styleFilterSel, setStyleFilterSel] = useState(initialStyle ? [initialStyle] : []);
  const [sizeFilter, setSizeFilter] = useState([]);
  const [colorFilter, setColorFilter] = useState([]);
  const [priceFilter, setPriceFilter] = useState(null);
  const [sort, setSort] = useState("newest");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [query, setQuery] = useState("");

  const toggle = (arr, setArr, val) => setArr(arr.includes(val) ? arr.filter((v) => v !== val) : [...arr, val]);

  const priceRanges = [
    { label: "Under $50", test: (p) => p < 50 },
    { label: "$50 – $100", test: (p) => p >= 50 && p <= 100 },
    { label: "$100 – $200", test: (p) => p > 100 && p <= 200 },
    { label: "$200+", test: (p) => p > 200 },
  ];

  const filtered = useMemo(() => {
    let list = products.filter((p) => {
      if (query.trim() && !p.name.toLowerCase().includes(query.trim().toLowerCase())) return false;
      if (categoryFilter.length && !categoryFilter.includes(p.category)) return false;
      if (styleFilterSel.length && !(p.styles || []).some((s) => styleFilterSel.includes(s))) return false;
      if (sizeFilter.length && !p.sizes.some((s) => sizeFilter.includes(s))) return false;
      if (colorFilter.length && !p.colors.some((c) => colorFilter.includes(c))) return false;
      if (priceFilter) {
        const range = priceRanges.find((r) => r.label === priceFilter);
        if (range && !range.test(p.price)) return false;
      }
      return true;
    });
    if (sort === "newest") list = [...list].sort((a, b) => b.createdAt - a.createdAt);
    if (sort === "price-asc") list = [...list].sort((a, b) => a.price - b.price);
    if (sort === "price-desc") list = [...list].sort((a, b) => b.price - a.price);
    return list;
  }, [products, query, categoryFilter, styleFilterSel, sizeFilter, colorFilter, priceFilter, sort]);

  const clearAll = () => {
    setCategoryFilter([]);
    setStyleFilterSel([]);
    setSizeFilter([]);
    setColorFilter([]);
    setPriceFilter(null);
    setQuery("");
  };
  const activeCount = categoryFilter.length + styleFilterSel.length + sizeFilter.length + colorFilter.length + (priceFilter ? 1 : 0);
  const catList = categories && categories.length ? categories : DEFAULT_CATEGORIES;
  const colorList = colors && colors.length ? colors : DEFAULT_COLORS;

  const FilterPanel = (
    <div className="space-y-8">
      <div>
        <h4 className="uppercase text-xs tracking-widest text-neutral-500 mb-3">Category</h4>
        <div className="flex flex-wrap gap-2">
          {catList.map((c) => (
            <button
              key={c}
              onClick={() => toggle(categoryFilter, setCategoryFilter, c)}
              className={`px-3 py-1.5 text-xs border transition-colors ${categoryFilter.includes(c) ? "bg-white text-black border-white" : "border-neutral-700 text-neutral-300 hover:border-neutral-400"}`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>
      <div>
        <h4 className="uppercase text-xs tracking-widest text-neutral-500 mb-3">Style</h4>
        <div className="flex flex-wrap gap-2">
          {STYLES.map((s) => (
            <button
              key={s}
              onClick={() => toggle(styleFilterSel, setStyleFilterSel, s)}
              className={`px-3 py-1.5 text-xs border transition-colors ${styleFilterSel.includes(s) ? "bg-white text-black border-white" : "border-neutral-700 text-neutral-300 hover:border-neutral-400"}`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
      <div>
        <h4 className="uppercase text-xs tracking-widest text-neutral-500 mb-3">Size</h4>
        <div className="flex flex-wrap gap-2">
          {ALL_SIZES.map((s) => (
            <button
              key={s}
              onClick={() => toggle(sizeFilter, setSizeFilter, s)}
              className={`w-9 h-9 text-xs border transition-colors ${sizeFilter.includes(s) ? "bg-white text-black border-white" : "border-neutral-700 text-neutral-300 hover:border-neutral-400"}`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
      <div>
        <h4 className="uppercase text-xs tracking-widest text-neutral-500 mb-3">Color</h4>
        <div className="flex flex-wrap gap-2">
          {colorList.map((c) => (
            <button
              key={c.name}
              onClick={() => toggle(colorFilter, setColorFilter, c.name)}
              className={`flex items-center gap-2 px-2.5 py-1.5 text-xs border transition-colors ${colorFilter.includes(c.name) ? "border-white bg-neutral-900" : "border-neutral-700 hover:border-neutral-400"}`}
            >
              <span className="w-3 h-3 rounded-full border border-neutral-600" style={{ background: c.hex }} />
              {c.name}
            </button>
          ))}
        </div>
      </div>
      <div>
        <h4 className="uppercase text-xs tracking-widest text-neutral-500 mb-3">Price</h4>
        <div className="flex flex-col gap-2">
          {priceRanges.map((r) => (
            <button
              key={r.label}
              onClick={() => setPriceFilter(priceFilter === r.label ? null : r.label)}
              className={`text-left px-3 py-2 text-xs border transition-colors ${priceFilter === r.label ? "bg-white text-black border-white" : "border-neutral-700 text-neutral-300 hover:border-neutral-400"}`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      {activeCount > 0 && (
        <button onClick={clearAll} className="text-xs text-neutral-500 underline hover:text-white">
          Clear all filters
        </button>
      )}
    </div>
  );

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
      <h1 className="font-display text-3xl sm:text-4xl mb-2 tracking-wide">Shop</h1>
      <p className="text-neutral-500 text-sm mb-5">{filtered.length} products</p>

      <div className="relative mb-6 max-w-sm">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search products…"
          className="w-full bg-transparent border border-neutral-700 pl-9 pr-9 py-2.5 text-sm focus:border-white"
        />
        {query && (
          <button onClick={() => setQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-white tap-scale" aria-label="Clear search">
            <X size={14} />
          </button>
        )}
      </div>

      <div className="flex gap-10">
        <aside className="hidden md:block w-56 flex-shrink-0">{FilterPanel}</aside>

        <div className="flex-1">
          <div className="flex items-center justify-between mb-6 gap-3">
            <button
              onClick={() => setFiltersOpen(true)}
              className="md:hidden flex items-center gap-2 border border-neutral-700 px-4 py-2 text-xs uppercase tracking-widest"
            >
              <SlidersHorizontal size={14} /> Filters {activeCount > 0 && `(${activeCount})`}
            </button>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              className="bg-black border border-neutral-700 text-xs uppercase tracking-widest px-3 py-2 ml-auto"
            >
              <option value="newest">Newest</option>
              <option value="price-asc">Price: Low to High</option>
              <option value="price-desc">Price: High to Low</option>
            </select>
          </div>

          {filtered.length === 0 ? (
            <div className="text-center py-24 text-neutral-500">
              <p className="mb-4">No products match those filters.</p>
              <button onClick={clearAll} className="underline text-sm">Clear filters</button>
            </div>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-6">
              {filtered.map((p) => (
                <ProductCard key={p.id} product={p} onNavigate={onNavigate} onAddToCart={onAddToCart} wishlist={wishlist} onToggleWishlist={onToggleWishlist} colors={colors} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* mobile filter sheet */}
      {filtersOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black" style={{ opacity: 0.7 }} onClick={() => setFiltersOpen(false)} />
          <div className="absolute bottom-0 left-0 right-0 bg-black border-t border-neutral-800 rounded-t-2xl p-6 slide-in-right" style={{ maxHeight: "85vh", overflowY: "auto" }}>
            <div className="flex items-center justify-between mb-6">
              <h3 className="font-display text-lg">Filters</h3>
              <button onClick={() => setFiltersOpen(false)}><X size={20} /></button>
            </div>
            {FilterPanel}
            <button
              onClick={() => setFiltersOpen(false)}
              className="w-full bg-white text-black py-3 uppercase tracking-widest text-sm font-semibold mt-8"
            >
              Show {filtered.length} results
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------
   PRODUCT DETAIL PAGE
---------------------------------------------------------------- */

function ProductDetailPage({ product, products, onNavigate, onAddToCart, wishlist = [], onToggleWishlist, colors }) {
  const [imgIndex, setImgIndex] = useState(0);
  const [size, setSize] = useState(product ? product.sizes[0] : null);
  const [color, setColor] = useState(product ? product.colors[0] : null);
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);

  useEffect(() => {
    if (product) {
      setImgIndex(0);
      setSize(product.sizes[0]);
      setColor(product.colors[0]);
      setQty(1);
      setAdded(false);
    }
  }, [product && product.id]);

  if (!product) {
    return (
      <div className="max-w-6xl mx-auto px-6 py-24 text-center">
        <p className="text-neutral-400 mb-6">Product not found.</p>
        <button onClick={() => onNavigate("shop")} className="underline">Back to shop</button>
      </div>
    );
  }

  const related = products.filter((p) => p.category === product.category && p.id !== product.id).slice(0, 4);
  const outOfStock = totalStock(product) <= 0 || product.isSoldOut;
  const isWishlisted = wishlist.includes(product.id);
  const sale = onSale(product);
  const currentVariant = findVariant(product, size, color);
  const variantStock = currentVariant ? currentVariant.stock : totalStock(product);
  const variantUnavailable = !product.isSoldOut && Array.isArray(product.variants) && product.variants.length > 0 && (!currentVariant || currentVariant.stock <= 0);
  const hexMap = hexMapFrom(colors && colors.length ? colors : DEFAULT_COLORS);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 fade-in">
      <button onClick={() => onNavigate("shop")} className="text-sm text-neutral-500 hover:text-white flex items-center gap-1 mb-6">
        <ChevronLeft size={14} /> Back to shop
      </button>

      <div className="grid md:grid-cols-2 gap-8 lg:gap-14">
        <div>
          <div className="bg-neutral-950" style={{ aspectRatio: "3/4" }}>
            <img
              key={imgIndex}
              src={product.images[imgIndex]}
              alt={product.name}
              className="w-full h-full object-cover fade-in"
              style={{ filter: "grayscale(1) contrast(1.05)" }}
            />
          </div>
          {product.images.length > 1 && (
            <div className="flex gap-2 mt-3">
              {product.images.map((im, i) => (
                <button
                  key={i}
                  onClick={() => setImgIndex(i)}
                  className="w-16 h-20 flex-shrink-0"
                  style={{ outline: imgIndex === i ? "2px solid #fff" : "1px solid #333" }}
                >
                  <img src={im} alt="" className="w-full h-full object-cover" style={{ filter: "grayscale(1)" }} />
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          {product.isNew && <span className="text-xs uppercase tracking-widest text-neutral-400">New Arrival</span>}
          {!product.isNew && sale && <span className="text-xs uppercase tracking-widest text-neutral-400">Sale</span>}
          <div className="flex items-start justify-between gap-4">
            <h1 className="font-display text-2xl sm:text-3xl mt-2 mb-2">{product.name}</h1>
            {onToggleWishlist && (
              <button
                onClick={() => onToggleWishlist(product.id)}
                className="mt-2 flex-shrink-0 w-10 h-10 rounded-full border border-neutral-700 flex items-center justify-center tap-scale"
                aria-label="Toggle wishlist"
              >
                <Heart size={16} className={isWishlisted ? "fill-white" : ""} />
              </button>
            )}
          </div>
          <p className="text-xl mb-1 flex items-center gap-3">
            <span className={sale ? "text-white" : "text-neutral-300"}>{fmt(product.price)}</span>
            {sale && <span className="text-neutral-600 line-through text-base">{fmt(product.compareAtPrice)}</span>}
          </p>
          <div className="flex flex-wrap items-center gap-1.5 mb-5 mt-2">
            {product.fabric && (
              <span className="text-[10px] uppercase tracking-widest border border-neutral-700 text-neutral-400 px-2 py-1">{product.fabric}</span>
            )}
            {product.styles && product.styles.map((s) => (
              <span key={s} className="text-[10px] uppercase tracking-widest border border-neutral-700 text-neutral-400 px-2 py-1">{s}</span>
            ))}
          </div>
          <p className="text-neutral-400 text-sm leading-relaxed mb-8 mt-3">{product.description}</p>

          <div className="mb-6">
            <h4 className="uppercase text-xs tracking-widest text-neutral-500 mb-3">Color: {color}</h4>
            <div className="flex gap-2">
              {product.colors.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className="w-9 h-9 rounded-full border-2 transition-transform"
                  style={{ background: hexMap[c], borderColor: color === c ? "#fff" : "transparent", transform: color === c ? "scale(1.1)" : "scale(1)" }}
                  title={c}
                />
              ))}
            </div>
          </div>

          <div className="mb-8">
            <h4 className="uppercase text-xs tracking-widest text-neutral-500 mb-3">Size: {size}</h4>
            <div className="flex flex-wrap gap-2">
              {product.sizes.map((s) => {
                const v = findVariant(product, s, color);
                const sOut = Array.isArray(product.variants) && product.variants.length > 0 && (!v || v.stock <= 0);
                return (
                  <button
                    key={s}
                    onClick={() => setSize(s)}
                    className={`relative min-w-11 h-11 px-3 text-sm border transition-colors ${size === s ? "bg-white text-black border-white" : "border-neutral-700 hover:border-neutral-400"} ${sOut ? "opacity-30" : ""}`}
                  >
                    {s}
                    {sOut && <span className="absolute inset-x-0 top-1/2 h-px bg-current" />}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-4 mb-8">
            <h4 className="uppercase text-xs tracking-widest text-neutral-500">Quantity</h4>
            <div className="flex items-center border border-neutral-700">
              <button onClick={() => setQty((q) => Math.max(1, q - 1))} className="p-3 tap-scale"><Minus size={14} /></button>
              <span className="w-8 text-center text-sm">{qty}</span>
              <button onClick={() => setQty((q) => Math.min(Math.max(1, variantStock), q + 1))} className="p-3 tap-scale"><Plus size={14} /></button>
            </div>
          </div>

          {outOfStock ? (
            <button disabled className="w-full bg-neutral-800 text-neutral-500 py-4 uppercase tracking-widest text-sm font-semibold">
              Sold Out
            </button>
          ) : variantUnavailable ? (
            <button disabled className="w-full bg-neutral-800 text-neutral-500 py-4 uppercase tracking-widest text-sm font-semibold">
              Unavailable in {color} / {size}
            </button>
          ) : (
            <button
              onClick={() => {
                onAddToCart(product, size, color, qty);
                setAdded(true);
                setTimeout(() => setAdded(false), 1800);
              }}
              className="btn-shine w-full bg-white text-black py-4 uppercase tracking-widest text-sm font-semibold flex items-center justify-center gap-2 hover-lift"
            >
              {added ? (<><Check size={16} /> Added to Cart</>) : (<><ShoppingBag size={16} /> Add to Cart</>)}
            </button>
          )}
          {!outOfStock && !variantUnavailable && variantStock > 0 && variantStock <= 5 && (
            <p className="text-xs text-neutral-500 mt-3">Only {variantStock} left in {color} / {size}.</p>
          )}
        </div>
      </div>

      {related.length > 0 && (
        <section className="mt-20">
          <h2 className="font-display text-2xl mb-6 tracking-wide">You May Also Like</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-6">
            {related.map((p) => (
              <ProductCard key={p.id} product={p} onNavigate={onNavigate} onAddToCart={onAddToCart} wishlist={wishlist} onToggleWishlist={onToggleWishlist} colors={colors} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------
   WISHLIST PAGE
---------------------------------------------------------------- */

function WishlistPage({ products, wishlist, onToggleWishlist, onNavigate, onAddToCart, colors }) {
  const items = products.filter((p) => wishlist.includes(p.id));

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
      <h1 className="font-display text-3xl sm:text-4xl mb-2 tracking-wide flex items-center gap-3">
        <Heart size={26} className="fill-white" /> Wishlist
      </h1>
      <p className="text-neutral-500 text-sm mb-8">{items.length} saved item{items.length === 1 ? "" : "s"}</p>

      {items.length === 0 ? (
        <div className="text-center py-24">
          <Heart size={36} className="text-neutral-700 mb-4 mx-auto" />
          <p className="text-neutral-500 mb-6">Nothing saved yet — tap the heart on any product to add it here.</p>
          <button
            onClick={() => onNavigate("shop")}
            className="bg-white text-black px-6 py-3 uppercase tracking-widest text-xs font-semibold"
          >
            Browse the Shop
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6">
          {items.map((p) => (
            <ProductCard key={p.id} product={p} onNavigate={onNavigate} onAddToCart={onAddToCart} wishlist={wishlist} onToggleWishlist={onToggleWishlist} colors={colors} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------
   ABOUT PAGE
---------------------------------------------------------------- */

function AboutPage({ onNavigate }) {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16 fade-in">
      <Reveal>
        <h1 className="font-display text-3xl sm:text-4xl mb-8 tracking-wide text-center">About Us</h1>
      </Reveal>

      <Reveal delay={100}>
        <section className="mb-12">
          <h2 className="font-display text-lg tracking-wide mb-3">Our Story</h2>
          <p className="text-neutral-400 text-sm leading-relaxed">
            LIMITLESS FOR MEN is an independent, locally-run menswear store. Every piece is picked with a clean,
            modern, and slightly futuristic identity in mind — built for men who never settle. We&rsquo;re a small
            team, not a big retail chain, and we like it that way: every order is handled personally, from the
            moment you message us to the moment it&rsquo;s in your hands.
          </p>
        </section>
      </Reveal>

      <Reveal delay={130}>
        <section className="mb-12">
          <h2 className="font-display text-lg tracking-wide mb-3 flex items-center gap-2">
            <MapPin size={16} /> Visit Us
          </h2>
          <p className="text-neutral-400 text-sm leading-relaxed">
            Our store is located in Sohmor, West Bekaa, right on the main road.
          </p>
        </section>
      </Reveal>

      <Reveal delay={150}>
        <section className="mb-12">
          <h2 className="font-display text-lg tracking-wide mb-3 flex items-center gap-2">
            <Package size={16} /> Delivery & Payment
          </h2>
          <ul className="text-neutral-400 text-sm leading-relaxed space-y-2 list-disc pl-5">
            <li>We currently deliver locally — we don&rsquo;t ship through large international couriers.</li>
            <li>Every order is confirmed directly with you over WhatsApp after checkout.</li>
            <li>Payment is Cash on Delivery — you pay when your order arrives, no card needed online.</li>
            <li>Delivery time is typically 1–3 business days depending on your area; we&rsquo;ll confirm an estimate when we message you back.</li>
          </ul>
        </section>
      </Reveal>

      <Reveal delay={200}>
        <section className="mb-12">
          <h2 className="font-display text-lg tracking-wide mb-3 flex items-center gap-2">
            <ChevronLeft size={16} className="rotate-180" /> Exchanges & Returns
          </h2>
          <ul className="text-neutral-400 text-sm leading-relaxed space-y-2 list-disc pl-5">
            <li>If a size or item isn&rsquo;t right, message us on WhatsApp within 3 days of delivery.</li>
            <li>Items must be unworn, unwashed, and with tags attached to be eligible for exchange.</li>
            <li>We handle exchanges directly and personally — no forms, just message us and we&rsquo;ll sort it out.</li>
          </ul>
        </section>
      </Reveal>

      <Reveal delay={250}>
        <section className="text-center pt-8 border-t border-neutral-900">
          <p className="text-neutral-400 text-sm mb-5">Questions before you order? We&rsquo;re one message away.</p>
          <div className="flex justify-center gap-3 flex-wrap">
            <a
              href={whatsappLink("مرحباً، عندي سؤال بخصوص طلب.")}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-white text-black px-6 py-3 uppercase tracking-widest text-xs font-semibold flex items-center gap-2 tap-scale"
            >
              <MessageCircle size={15} /> Message on WhatsApp
            </a>
            <button
              onClick={() => onNavigate("shop")}
              className="border border-neutral-700 px-6 py-3 uppercase tracking-widest text-xs font-semibold tap-scale"
            >
              Browse the Shop
            </button>
          </div>
        </section>
      </Reveal>
    </div>
  );
}

/* ---------------------------------------------------------------
   SEARCH OVERLAY
---------------------------------------------------------------- */

function SearchOverlay({ open, onClose, products, categories, colors, onNavigate, onAddToCart, wishlist, onToggleWishlist }) {
  const [query, setQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState([]);
  const [styleFilter, setStyleFilter] = useState([]);
  const [sizeFilter, setSizeFilter] = useState([]);
  const [colorFilter, setColorFilter] = useState([]);
  const [priceFilter, setPriceFilter] = useState(null);
  const inputRef = useRef(null);

  const catList = categories && categories.length ? categories : DEFAULT_CATEGORIES;
  const colorList = colors && colors.length ? colors : DEFAULT_COLORS;
  const priceRanges = [
    { label: "Under $50", test: (p) => p < 50 },
    { label: "$50 – $100", test: (p) => p >= 50 && p <= 100 },
    { label: "$100 – $200", test: (p) => p > 100 && p <= 200 },
    { label: "$200+", test: (p) => p > 200 },
  ];
  const toggle = (arr, setArr, val) => setArr(arr.includes(val) ? arr.filter((v) => v !== val) : [...arr, val]);
  const activeFilterCount = categoryFilter.length + styleFilter.length + sizeFilter.length + colorFilter.length + (priceFilter ? 1 : 0);

  useEffect(() => {
    if (open) {
      setQuery("");
      setFiltersOpen(false);
      setCategoryFilter([]); setStyleFilter([]); setSizeFilter([]); setColorFilter([]); setPriceFilter(null);
      const t = setTimeout(() => inputRef.current && inputRef.current.focus(), 350);
      return () => clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const hasFilters = activeFilterCount > 0;

  const results = (tokens.length || hasFilters)
    ? products.filter((p) => {
        if (tokens.length) {
          const haystacks = [p.name, p.category, p.fabric, ...(p.colors || []), ...(p.styles || [])]
            .filter(Boolean)
            .map((s) => s.toLowerCase());
          if (!tokens.every((t) => haystacks.some((h) => h.includes(t)))) return false;
        }
        if (categoryFilter.length && !categoryFilter.includes(p.category)) return false;
        if (styleFilter.length && !(p.styles || []).some((s) => styleFilter.includes(s))) return false;
        if (sizeFilter.length && !p.sizes.some((s) => sizeFilter.includes(s))) return false;
        if (colorFilter.length && !p.colors.some((c) => colorFilter.includes(c))) return false;
        if (priceFilter) {
          const range = priceRanges.find((r) => r.label === priceFilter);
          if (range && !range.test(p.price)) return false;
        }
        return true;
      })
    : [];

  return (
    <div className="fixed inset-0 z-50 fade-in">
      <div className="absolute inset-0 bg-black" style={{ opacity: 0.85 }} onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 top-0 sm:top-auto sm:bottom-0 bg-black flex flex-col sheet-up" style={{ maxHeight: "100vh" }}>
        <div className="flex items-center gap-3 p-4 border-b border-neutral-800 flex-shrink-0">
          <Search size={18} className="text-neutral-500 flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search products, colors, styles…"
            className="flex-1 bg-transparent text-lg outline-none min-w-0"
          />
          {query && (
            <button onClick={() => setQuery("")} className="text-neutral-500 hover:text-white tap-scale flex-shrink-0" aria-label="Clear">
              <X size={16} />
            </button>
          )}
          <button onClick={onClose} className="text-neutral-400 hover:text-white tap-scale flex-shrink-0 uppercase text-xs tracking-widest">
            Cancel
          </button>
        </div>

        <div className="flex items-center gap-2 px-4 py-3 border-b border-neutral-800 flex-shrink-0 overflow-x-auto">
          <button
            onClick={() => setFiltersOpen((v) => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs uppercase tracking-widest border flex-shrink-0 tap-scale ${filtersOpen || hasFilters ? "bg-white text-black border-white" : "border-neutral-700 text-neutral-300"}`}
          >
            <SlidersHorizontal size={13} /> Filters {activeFilterCount > 0 && `(${activeFilterCount})`}
          </button>
          {hasFilters && (
            <button
              onClick={() => { setCategoryFilter([]); setStyleFilter([]); setSizeFilter([]); setColorFilter([]); setPriceFilter(null); }}
              className="text-xs text-neutral-500 underline flex-shrink-0"
            >
              Clear
            </button>
          )}
        </div>

        {filtersOpen && (
          <div className="px-4 py-4 border-b border-neutral-800 flex-shrink-0 overflow-y-auto fade-in" style={{ maxHeight: "40vh" }}>
            <div className="space-y-5 max-w-2xl mx-auto">
              <div>
                <h4 className="uppercase text-[10px] tracking-widest text-neutral-500 mb-2">Category</h4>
                <div className="flex flex-wrap gap-2">
                  {catList.map((c) => (
                    <button key={c} onClick={() => toggle(categoryFilter, setCategoryFilter, c)} className={`px-2.5 py-1.5 text-xs border ${categoryFilter.includes(c) ? "bg-white text-black border-white" : "border-neutral-700 text-neutral-300"}`}>{c}</button>
                  ))}
                </div>
              </div>
              <div>
                <h4 className="uppercase text-[10px] tracking-widest text-neutral-500 mb-2">Style</h4>
                <div className="flex flex-wrap gap-2">
                  {STYLES.map((s) => (
                    <button key={s} onClick={() => toggle(styleFilter, setStyleFilter, s)} className={`px-2.5 py-1.5 text-xs border ${styleFilter.includes(s) ? "bg-white text-black border-white" : "border-neutral-700 text-neutral-300"}`}>{s}</button>
                  ))}
                </div>
              </div>
              <div>
                <h4 className="uppercase text-[10px] tracking-widest text-neutral-500 mb-2">Size</h4>
                <div className="flex flex-wrap gap-2">
                  {ALL_SIZES.map((s) => (
                    <button key={s} onClick={() => toggle(sizeFilter, setSizeFilter, s)} className={`w-8 h-8 text-xs border ${sizeFilter.includes(s) ? "bg-white text-black border-white" : "border-neutral-700 text-neutral-300"}`}>{s}</button>
                  ))}
                </div>
              </div>
              <div>
                <h4 className="uppercase text-[10px] tracking-widest text-neutral-500 mb-2">Color</h4>
                <div className="flex flex-wrap gap-2">
                  {colorList.map((c) => (
                    <button key={c.name} onClick={() => toggle(colorFilter, setColorFilter, c.name)} className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs border ${colorFilter.includes(c.name) ? "border-white bg-neutral-900" : "border-neutral-700"}`}>
                      <span className="w-3 h-3 rounded-full border border-neutral-600" style={{ background: c.hex }} />{c.name}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <h4 className="uppercase text-[10px] tracking-widest text-neutral-500 mb-2">Price</h4>
                <div className="flex flex-wrap gap-2">
                  {priceRanges.map((r) => (
                    <button key={r.label} onClick={() => setPriceFilter(priceFilter === r.label ? null : r.label)} className={`px-2.5 py-1.5 text-xs border ${priceFilter === r.label ? "bg-white text-black border-white" : "border-neutral-700 text-neutral-300"}`}>{r.label}</button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-4 py-6">
          {tokens.length === 0 && !hasFilters && (
            <div className="text-center text-neutral-500 text-sm py-16">
              Start typing to search, or use Filters — try a product name, a color, or a style.
            </div>
          )}
          {(tokens.length > 0 || hasFilters) && results.length === 0 && (
            <div className="text-center text-neutral-500 text-sm py-16">
              No products match{query ? ` "${query}"` : ""}{hasFilters ? " with these filters" : ""}.
            </div>
          )}
          {results.length > 0 && (
            <>
              <p className="text-xs text-neutral-500 mb-4">{results.length} result{results.length === 1 ? "" : "s"}</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-6 max-w-6xl mx-auto">
                {results.map((p) => (
                  <ProductCard
                    key={p.id}
                    product={p}
                    onNavigate={onNavigate}
                    onAddToCart={onAddToCart}
                    wishlist={wishlist}
                    onToggleWishlist={onToggleWishlist}
                    colors={colors}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   CART DRAWER
---------------------------------------------------------------- */

function CartDrawer({ open, onClose, cart, subtotal, shipping, total, onUpdateQty, onRemove, onNavigate }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black" style={{ opacity: 0.6 }} onClick={onClose} />
      <div className="absolute right-0 top-0 h-full w-full sm:w-96 bg-black border-l border-neutral-800 flex flex-col slide-in-right">
        <div className="flex items-center justify-between p-5 border-b border-neutral-800">
          <h3 className="font-display text-lg tracking-wide">Your Cart ({cart.reduce((a, c) => a + c.qty, 0)})</h3>
          <button onClick={onClose} aria-label="Close cart"><X size={20} /></button>
        </div>

        {cart.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
            <ShoppingBag size={36} className="text-neutral-700 mb-4" />
            <p className="text-neutral-500 mb-6">Your cart is empty.</p>
            <button
              onClick={() => { onClose(); onNavigate("shop"); }}
              className="bg-white text-black px-6 py-3 uppercase tracking-widest text-xs font-semibold"
            >
              Continue Shopping
            </button>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {cart.map((item) => (
                <div key={item.key} className="flex gap-3">
                  <img src={item.image} alt={item.name} className="w-20 h-24 object-cover flex-shrink-0" style={{ filter: "grayscale(1)" }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm">{item.name}</p>
                    <p className="text-xs text-neutral-500 mt-0.5">{item.color} / {item.size}</p>
                    <p className="text-sm text-neutral-300 mt-1">{fmt(item.price)}</p>
                    <div className="flex items-center justify-between mt-2">
                      <div className="flex items-center border border-neutral-700">
                        <button onClick={() => onUpdateQty(item.key, -1)} className="p-1.5 tap-scale"><Minus size={12} /></button>
                        <span className="w-6 text-center text-xs">{item.qty}</span>
                        <button onClick={() => onUpdateQty(item.key, 1)} className="p-1.5 tap-scale"><Plus size={12} /></button>
                      </div>
                      <button onClick={() => onRemove(item.key)} className="text-neutral-500 hover:text-white tap-scale">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="p-5 border-t border-neutral-800 space-y-2">
              <div className="flex justify-between text-sm text-neutral-400">
                <span>Subtotal</span><span>{fmt(subtotal)}</span>
              </div>
              <div className="flex justify-between text-sm text-neutral-400">
                <span>Shipping</span><span>{shipping === 0 ? "Free" : fmt(shipping)}</span>
              </div>
              <div className="flex justify-between text-base pt-2 border-t border-neutral-800 mt-2">
                <span>Total</span><span>{fmt(total)}</span>
              </div>
              <button
                onClick={() => { onClose(); onNavigate("checkout"); }}
                className="btn-shine w-full bg-white text-black py-4 uppercase tracking-widest text-sm font-semibold mt-3 hover-lift"
              >
                Proceed to Checkout
              </button>
              <button
                onClick={() => { onClose(); onNavigate("shop"); }}
                className="w-full text-neutral-400 text-xs uppercase tracking-widest py-3"
              >
                Continue Shopping
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   CHECKOUT
---------------------------------------------------------------- */

function CheckoutPage({ cart, subtotal, shipping, total, onNavigate, onPlaceOrder }) {
  const [form, setForm] = useState({ fullName: "", phone: "", address: "", city: "", notes: "" });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  if (cart.length === 0) {
    return (
      <div className="max-w-xl mx-auto px-6 py-24 text-center">
        <p className="text-neutral-400 mb-6">Your cart is empty — add something before checking out.</p>
        <button onClick={() => onNavigate("shop")} className="bg-white text-black px-6 py-3 uppercase tracking-widest text-xs font-semibold">
          Go to Shop
        </button>
      </div>
    );
  }

  function validate() {
    const e = {};
    if (!form.fullName.trim()) e.fullName = "Required";
    if (!form.phone.trim()) e.phone = "Required";
    if (!form.address.trim()) e.address = "Required";
    if (!form.city.trim()) e.city = "Required";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit() {
    if (!validate()) return;
    setSubmitting(true);
    await onPlaceOrder(form);
    setSubmitting(false);
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
      <h1 className="font-display text-3xl mb-8 tracking-wide">Checkout</h1>
      <div className="grid md:grid-cols-2 gap-12">
        <div className="space-y-5">
          <div>
            <label className="text-xs uppercase tracking-widest text-neutral-500 mb-2 block">Full Name</label>
            <input
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              className="w-full bg-transparent border border-neutral-700 px-4 py-3 text-sm"
              placeholder="John Doe"
            />
            {errors.fullName && <p className="text-xs text-neutral-400 mt-1">{errors.fullName}</p>}
          </div>
          <div>
            <label className="text-xs uppercase tracking-widest text-neutral-500 mb-2 block">Phone Number</label>
            <input
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              className="w-full bg-transparent border border-neutral-700 px-4 py-3 text-sm"
              placeholder="+1 555 000 0000"
            />
            {errors.phone && <p className="text-xs text-neutral-400 mt-1">{errors.phone}</p>}
          </div>
          <div>
            <label className="text-xs uppercase tracking-widest text-neutral-500 mb-2 block">Address</label>
            <input
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              className="w-full bg-transparent border border-neutral-700 px-4 py-3 text-sm"
              placeholder="Street, building, apartment"
            />
            {errors.address && <p className="text-xs text-neutral-400 mt-1">{errors.address}</p>}
          </div>
          <div>
            <label className="text-xs uppercase tracking-widest text-neutral-500 mb-2 block">City</label>
            <input
              value={form.city}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
              className="w-full bg-transparent border border-neutral-700 px-4 py-3 text-sm"
              placeholder="City"
            />
            {errors.city && <p className="text-xs text-neutral-400 mt-1">{errors.city}</p>}
          </div>
          <div>
            <label className="text-xs uppercase tracking-widest text-neutral-500 mb-2 block">Order Notes (optional)</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="w-full bg-transparent border border-neutral-700 px-4 py-3 text-sm"
              rows={3}
              placeholder="Delivery instructions, landmark, preferred time…"
            />
          </div>
          <div className="glass p-4 text-xs text-neutral-400 flex items-start gap-2">
            <MessageCircle size={15} className="flex-shrink-0 mt-0.5" />
            <span>Payment: Cash on Delivery. After you submit, we&rsquo;ll open WhatsApp with your order details ready to send — that&rsquo;s how we confirm and arrange delivery.</span>
          </div>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="btn-shine w-full bg-white text-black py-4 uppercase tracking-widest text-sm font-semibold hover-lift disabled:opacity-60 flex items-center justify-center gap-2"
          >
            <MessageCircle size={16} />
            {submitting ? "Placing Order…" : "Place Order via WhatsApp"}
          </button>
        </div>

        <div>
          <h3 className="uppercase text-xs tracking-widest text-neutral-500 mb-4">Order Summary</h3>
          <div className="space-y-4 mb-6">
            {cart.map((item) => (
              <div key={item.key} className="flex gap-3">
                <img src={item.image} alt="" className="w-16 h-20 object-cover" style={{ filter: "grayscale(1)" }} />
                <div className="flex-1">
                  <p className="text-sm">{item.name}</p>
                  <p className="text-xs text-neutral-500">{item.color} / {item.size} × {item.qty}</p>
                </div>
                <p className="text-sm">{fmt(item.price * item.qty)}</p>
              </div>
            ))}
          </div>
          <div className="space-y-2 border-t border-neutral-800 pt-4">
            <div className="flex justify-between text-sm text-neutral-400"><span>Subtotal</span><span>{fmt(subtotal)}</span></div>
            <div className="flex justify-between text-sm text-neutral-400"><span>Shipping</span><span>{shipping === 0 ? "Free" : fmt(shipping)}</span></div>
            <div className="flex justify-between text-base pt-2 border-t border-neutral-800"><span>Total</span><span>{fmt(total)}</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ConfirmationPage({ order, onNavigate }) {
  if (!order) {
    return (
      <div className="max-w-xl mx-auto px-6 py-24 text-center">
        <button onClick={() => onNavigate("home")} className="underline">Return home</button>
      </div>
    );
  }
  return (
    <div className="max-w-xl mx-auto px-6 py-24 text-center fade-in">
      <div className="w-16 h-16 rounded-full border border-white flex items-center justify-center mx-auto mb-6">
        <Check size={26} />
      </div>
      <h1 className="font-display text-2xl mb-3 tracking-wide">Thank You, {order.customer.fullName.split(" ")[0]}!</h1>
      <p className="text-neutral-400 mb-1">Order #{order.id}</p>
      <p className="text-neutral-400 text-sm mb-8">We really appreciate you shopping with LIMITLESS FOR MEN. We opened WhatsApp with your order details — send the message to confirm with us directly.</p>
      <div className="glass p-6 text-left mb-8">
        <div className="flex justify-between text-sm mb-2"><span className="text-neutral-500">Total</span><span>{fmt(order.total)}</span></div>
        <div className="flex justify-between text-sm mb-2"><span className="text-neutral-500">Delivery to</span><span>{order.customer.city}</span></div>
        <div className="flex justify-between text-sm"><span className="text-neutral-500">Payment</span><span>Cash on Delivery</span></div>
      </div>
      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <a
          href={whatsappLink(buildWhatsAppMessage(order))}
          target="_blank"
          rel="noopener noreferrer"
          className="bg-white text-black px-8 py-3.5 uppercase tracking-widest text-xs font-semibold flex items-center justify-center gap-2"
        >
          <MessageCircle size={15} /> Open WhatsApp Again
        </a>
        <button onClick={() => onNavigate("shop")} className="border border-neutral-700 px-8 py-3.5 uppercase tracking-widest text-xs font-semibold">
          Continue Shopping
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   ADMIN LOGIN
---------------------------------------------------------------- */

function AdminLoginPage({ onSuccess, adminPassword }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  function handleSubmit() {
    if (password === adminPassword) {
      setError("");
      onSuccess();
    } else {
      setError("Incorrect password.");
    }
  }

  return (
    <div className="max-w-sm mx-auto px-6 py-24">
      <div className="flex flex-col items-center mb-8">
        <Lock size={28} className="text-neutral-500 mb-4" />
        <h1 className="font-display text-2xl tracking-wide">Admin Access</h1>
      </div>
      <div className="space-y-4">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
          placeholder="Password"
          className="w-full bg-transparent border border-neutral-700 px-4 py-3 text-sm"
          autoFocus
        />
        {error && <p className="text-xs text-neutral-400">{error}</p>}
        <button type="button" onClick={handleSubmit} className="w-full bg-white text-black py-3.5 uppercase tracking-widest text-xs font-semibold hover-lift">
          Log In
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   ADMIN DASHBOARD
---------------------------------------------------------------- */

function AdminDashboard({ products, orders, onSaveProducts, onSaveOrders, adminPassword, onChangePassword, categories, colors, onSaveCatalog, styleImages, onSaveStyleImages, catImages, onSaveCatImages, onLogout }) {
  const [tab, setTab] = useState("products");
  const [editing, setEditing] = useState(null); // product being edited, or 'new'

  async function upsertProduct(p) {
    let next;
    if (p.id && products.some((x) => x.id === p.id)) {
      next = products.map((x) => (x.id === p.id ? p : x));
    } else {
      next = [{ ...p, id: genId(), createdAt: Date.now() }, ...products];
    }
    await onSaveProducts(next);
    setEditing(null);
  }
  async function deleteProduct(id) {
    if (!window.confirm || true) {
      const next = products.filter((p) => p.id !== id);
      await onSaveProducts(next);
    }
  }
  async function toggleFlag(id, flag) {
    const next = products.map((p) => (p.id === id ? { ...p, [flag]: !p[flag] } : p));
    await onSaveProducts(next);
  }
  async function updateOrderStatus(id, status) {
    const next = orders.map((o) => (o.id === id ? { ...o, status } : o));
    await onSaveOrders(next);
  }
  async function deleteOrder(id) {
    const next = orders.filter((o) => o.id !== id);
    await onSaveOrders(next);
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="font-display text-2xl sm:text-3xl tracking-wide">Admin Dashboard</h1>
        <button onClick={onLogout} className="flex items-center gap-2 text-sm text-neutral-400 hover:text-white">
          <LogOut size={16} /> Log Out
        </button>
      </div>

      <div className="flex gap-2 mb-8 border-b border-neutral-800">
        <button
          onClick={() => setTab("products")}
          className={`flex items-center gap-2 px-4 py-3 text-sm uppercase tracking-widest border-b-2 -mb-px ${tab === "products" ? "border-white text-white" : "border-transparent text-neutral-500"}`}
        >
          <Package size={15} /> Products
        </button>
        <button
          onClick={() => setTab("orders")}
          className={`flex items-center gap-2 px-4 py-3 text-sm uppercase tracking-widest border-b-2 -mb-px ${tab === "orders" ? "border-white text-white" : "border-transparent text-neutral-500"}`}
        >
          <ClipboardList size={15} /> Orders {orders.filter((o) => ACTIVE_STATUSES.includes(o.status) && o.status !== "Shipped").length > 0 && `(${orders.filter((o) => ACTIVE_STATUSES.includes(o.status) && o.status !== "Shipped").length})`}
        </button>
        <button
          onClick={() => setTab("settings")}
          className={`flex items-center gap-2 px-4 py-3 text-sm uppercase tracking-widest border-b-2 -mb-px ${tab === "settings" ? "border-white text-white" : "border-transparent text-neutral-500"}`}
        >
          <Settings size={15} /> Settings
        </button>
        <button
          onClick={() => setTab("catalog")}
          className={`flex items-center gap-2 px-4 py-3 text-sm uppercase tracking-widest border-b-2 -mb-px ${tab === "catalog" ? "border-white text-white" : "border-transparent text-neutral-500"}`}
        >
          <SlidersHorizontal size={15} /> Catalog
        </button>
      </div>

      {tab === "products" && (
        <div>
          <button
            onClick={() => setEditing("new")}
            className="mb-6 flex items-center gap-2 bg-white text-black px-5 py-3 text-xs uppercase tracking-widest font-semibold"
          >
            <Plus size={15} /> Add Product
          </button>

          <div className="space-y-3">
            {products.map((p) => {
              const soldOut = totalStock(p) <= 0 || p.isSoldOut;
              return (
              <div key={p.id} className={`glass p-3 sm:p-4 flex items-center gap-4 ${soldOut ? "opacity-60" : ""}`}>
                <img src={p.images[0]} alt="" className="w-14 h-16 object-cover flex-shrink-0" style={{ filter: "grayscale(1)" }} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">{p.name}</p>
                  <p className="text-xs text-neutral-500">{p.category} · {fmt(p.price)} · Stock: {totalStock(p)}</p>
                  <div className="flex flex-wrap gap-2 mt-1.5">
                    <button
                      onClick={() => toggleFlag(p.id, "isFeatured")}
                      className={`text-[10px] uppercase tracking-widest px-2 py-0.5 border tap-scale ${p.isFeatured ? "bg-white text-black border-white" : "border-neutral-700 text-neutral-500"}`}
                    >
                      Featured
                    </button>
                    <button
                      onClick={() => toggleFlag(p.id, "isNew")}
                      className={`text-[10px] uppercase tracking-widest px-2 py-0.5 border tap-scale ${p.isNew ? "bg-white text-black border-white" : "border-neutral-700 text-neutral-500"}`}
                    >
                      New
                    </button>
                    <button
                      onClick={() => toggleFlag(p.id, "isBestSeller")}
                      className={`text-[10px] uppercase tracking-widest px-2 py-0.5 border tap-scale ${p.isBestSeller ? "bg-white text-black border-white" : "border-neutral-700 text-neutral-500"}`}
                    >
                      Best Seller
                    </button>
                    <button
                      onClick={() => toggleFlag(p.id, "isSoldOut")}
                      className={`text-[10px] uppercase tracking-widest px-2 py-0.5 border tap-scale ${p.isSoldOut ? "bg-white text-black border-white" : "border-neutral-700 text-neutral-500"}`}
                    >
                      {p.isSoldOut ? "Sold Out ✓" : "Mark Sold Out"}
                    </button>
                  </div>
                </div>
                <button onClick={() => setEditing(p)} className="p-2 text-neutral-400 hover:text-white tap-scale" aria-label="Edit"><Pencil size={16} /></button>
                <button onClick={() => deleteProduct(p.id)} className="p-2 text-neutral-400 hover:text-white tap-scale" aria-label="Delete"><Trash2 size={16} /></button>
              </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === "orders" && (
        <OrdersPanel orders={orders} onUpdateStatus={updateOrderStatus} onDelete={deleteOrder} />
      )}

      {tab === "settings" && (
        <SettingsPanel adminPassword={adminPassword} onChangePassword={onChangePassword} />
      )}

      {tab === "catalog" && (
        <CatalogPanel
          categories={categories}
          colors={colors}
          onSave={onSaveCatalog}
          products={products}
          styleImages={styleImages}
          onSaveStyleImages={onSaveStyleImages}
          catImages={catImages}
          onSaveCatImages={onSaveCatImages}
        />
      )}

      {editing && (
        <ProductFormModal
          product={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSave={upsertProduct}
          categories={categories}
          colors={colors}
        />
      )}
    </div>
  );
}

function SettingsPanel({ adminPassword, onChangePassword }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  function handleChangePassword() {
    setError("");
    setSuccess(false);
    if (current !== adminPassword) {
      setError("Current password is incorrect.");
      return;
    }
    if (next.length < 4) {
      setError("New password must be at least 4 characters.");
      return;
    }
    if (next !== confirm) {
      setError("New password and confirmation don't match.");
      return;
    }
    onChangePassword(next);
    setCurrent("");
    setNext("");
    setConfirm("");
    setSuccess(true);
    setTimeout(() => setSuccess(false), 3000);
  }

  return (
    <div className="max-w-sm">
      <h3 className="font-display text-lg tracking-wide mb-1">Change Admin Password</h3>
      <p className="text-xs text-neutral-500 mb-6">This changes the password used to log in to this dashboard, on any device.</p>
      <div className="space-y-4">
        <div>
          <label className="text-xs uppercase tracking-widest text-neutral-500 mb-2 block">Current Password</label>
          <input
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            className="w-full bg-transparent border border-neutral-700 px-4 py-3 text-sm"
          />
        </div>
        <div>
          <label className="text-xs uppercase tracking-widest text-neutral-500 mb-2 block">New Password</label>
          <input
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            className="w-full bg-transparent border border-neutral-700 px-4 py-3 text-sm"
          />
        </div>
        <div>
          <label className="text-xs uppercase tracking-widest text-neutral-500 mb-2 block">Confirm New Password</label>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleChangePassword(); }}
            className="w-full bg-transparent border border-neutral-700 px-4 py-3 text-sm"
          />
        </div>
        {error && <p className="text-xs text-neutral-400">{error}</p>}
        {success && <p className="text-xs text-neutral-300 flex items-center gap-1.5"><Check size={13} /> Password updated.</p>}
        <button
          type="button"
          onClick={handleChangePassword}
          className="w-full bg-white text-black py-3.5 uppercase tracking-widest text-xs font-semibold hover-lift tap-scale"
        >
          Update Password
        </button>
      </div>
    </div>
  );
}

function CatalogPanel({ categories, colors, onSave, products, styleImages = {}, onSaveStyleImages, catImages = {}, onSaveCatImages }) {
  const catList = categories && categories.length ? categories : DEFAULT_CATEGORIES;
  const colorList = colors && colors.length ? colors : DEFAULT_COLORS;
  const [newCategory, setNewCategory] = useState("");
  const [newColorName, setNewColorName] = useState("");
  const [newColorHex, setNewColorHex] = useState("#808080");

  function addCategory() {
    const name = newCategory.trim();
    if (!name) return;
    if (catList.some((c) => c.toLowerCase() === name.toLowerCase())) return;
    onSave([...catList, name], colorList);
    setNewCategory("");
  }
  function removeCategory(name) {
    const inUse = products.some((p) => p.category === name);
    if (inUse && !window.confirm(`"${name}" is used by existing products. Remove it from the catalog anyway? Those products will keep it, but it won't be selectable for new ones.`)) return;
    onSave(catList.filter((c) => c !== name), colorList);
  }

  function addColor() {
    const name = newColorName.trim();
    if (!name) return;
    if (colorList.some((c) => c.name.toLowerCase() === name.toLowerCase())) return;
    onSave(catList, [...colorList, { name, hex: newColorHex }]);
    setNewColorName("");
    setNewColorHex("#808080");
  }
  function removeColor(name) {
    const inUse = products.some((p) => (p.colors || []).includes(name));
    if (inUse && !window.confirm(`"${name}" is used by existing products. Remove it from the catalog anyway? Those products will keep it, but it won't be selectable for new ones.`)) return;
    onSave(catList, colorList.filter((c) => c.name !== name));
  }

  return (
    <div className="max-w-lg space-y-12">
      <div>
        <h3 className="font-display text-lg tracking-wide mb-1">Categories</h3>
        <p className="text-xs text-neutral-500 mb-4">Add or remove product categories. These appear on the homepage and in shop filters.</p>
        <div className="space-y-2 mb-4">
          {catList.map((c) => (
            <div key={c} className="flex items-center justify-between glass px-3 py-2">
              <span className="text-sm">{c}</span>
              <button onClick={() => removeCategory(c)} className="text-neutral-500 hover:text-white tap-scale" aria-label="Remove category">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          {catList.length === 0 && <p className="text-xs text-neutral-600">No categories yet.</p>}
        </div>
        <div className="flex gap-2">
          <input
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addCategory(); }}
            placeholder="New category name"
            className="flex-1 bg-transparent border border-neutral-700 px-3 py-2.5 text-sm"
          />
          <button onClick={addCategory} className="bg-white text-black px-4 uppercase tracking-widest text-xs font-semibold tap-scale">
            Add
          </button>
        </div>
      </div>

      <div>
        <h3 className="font-display text-lg tracking-wide mb-1">Colors</h3>
        <p className="text-xs text-neutral-500 mb-4">Add any color with any exact shade — pick it visually, no fixed list.</p>
        <div className="space-y-2 mb-4">
          {colorList.map((c) => (
            <div key={c.name} className="flex items-center justify-between glass px-3 py-2">
              <span className="flex items-center gap-2 text-sm">
                <span className="w-4 h-4 rounded-full border border-neutral-600 flex-shrink-0" style={{ background: c.hex }} />
                {c.name} <span className="text-neutral-600 text-xs">{c.hex}</span>
              </span>
              <button onClick={() => removeColor(c.name)} className="text-neutral-500 hover:text-white tap-scale" aria-label="Remove color">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          {colorList.length === 0 && <p className="text-xs text-neutral-600">No colors yet.</p>}
        </div>
        <div className="flex gap-2 items-center">
          <input
            type="color"
            value={newColorHex}
            onChange={(e) => setNewColorHex(e.target.value)}
            className="w-11 h-11 bg-transparent border border-neutral-700 p-1 flex-shrink-0"
            aria-label="Pick color"
          />
          <input
            value={newColorName}
            onChange={(e) => setNewColorName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addColor(); }}
            placeholder="Color name (e.g. Burgundy)"
            className="flex-1 bg-transparent border border-neutral-700 px-3 py-2.5 text-sm min-w-0"
          />
          <button onClick={addColor} className="bg-white text-black px-4 py-2.5 uppercase tracking-widest text-xs font-semibold tap-scale flex-shrink-0">
            Add
          </button>
        </div>
      </div>

      <CatalogImageSection
        title="Category Images"
        note="Upload a custom photo for each category tile shown on the homepage. Leave any unset and it'll use a placeholder."
        items={catList}
        images={catImages}
        onSave={onSaveCatImages}
      />

      <CatalogImageSection
        title="Style Images"
        note="Upload a custom photo for each style tile in the “Find Your Look” section on the homepage."
        items={STYLES}
        images={styleImages}
        onSave={onSaveStyleImages}
      />
    </div>
  );
}

function CatalogImageSection({ title, note, items, images, onSave }) {
  const [uploadingKey, setUploadingKey] = useState(null);

  async function handleUpload(key, file) {
    if (!file) return;
    setUploadingKey(key);
    try {
      const dataUrl = await resizeImageFile(file, 900, 0.75);
      await onSave({ ...images, [key]: dataUrl });
    } finally {
      setUploadingKey(null);
    }
  }

  function handleRemove(key) {
    const next = { ...images };
    delete next[key];
    onSave(next);
  }

  return (
    <div>
      <h3 className="font-display text-lg tracking-wide mb-1">{title}</h3>
      <p className="text-xs text-neutral-500 mb-4">{note}</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {items.map((key) => (
          <div key={key} className="space-y-1.5">
            <div className="relative bg-neutral-950 border border-neutral-800" style={{ aspectRatio: "4/5" }}>
              <img
                src={images[key] || img((title.includes("Style") ? "style-" : "cat-") + key)}
                alt={key}
                className="w-full h-full object-cover"
                style={{ filter: "grayscale(1)" }}
              />
              {images[key] && (
                <button
                  onClick={() => handleRemove(key)}
                  className="absolute top-1 right-1 bg-black/70 text-white rounded-full w-6 h-6 flex items-center justify-center tap-scale"
                  aria-label="Remove custom image"
                >
                  <X size={12} />
                </button>
              )}
            </div>
            <p className="text-xs text-neutral-400 truncate">{key}</p>
            <label className="flex items-center justify-center gap-1.5 text-[10px] uppercase tracking-widest text-neutral-400 border border-dashed border-neutral-700 py-2 cursor-pointer tap-scale">
              <Upload size={11} /> {uploadingKey === key ? "Uploading…" : "Upload"}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => handleUpload(key, e.target.files[0])}
              />
            </label>
          </div>
        ))}
      </div>
    </div>
  );
}

const ACTIVE_STATUSES = ["Pending", "Confirmed", "Preparing", "Shipped"];
const DONE_STATUSES = ["Delivered", "Cancelled"];

function OrdersPanel({ orders, onUpdateStatus, onDelete }) {
  const [filter, setFilter] = useState("active");

  const filtered = orders.filter((o) => {
    if (filter === "active") return ACTIVE_STATUSES.includes(o.status) && o.status !== "Shipped";
    if (filter === "shipped") return o.status === "Shipped";
    if (filter === "done") return DONE_STATUSES.includes(o.status);
    return true;
  });

  const tabs = [
    { key: "active", label: "Active" },
    { key: "shipped", label: "Shipped" },
    { key: "done", label: "Delivered / Cancelled" },
    { key: "all", label: "All" },
  ];

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-6">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setFilter(t.key)}
            className={`px-3 py-1.5 text-xs uppercase tracking-widest border ${filter === t.key ? "bg-white text-black border-white" : "border-neutral-700 text-neutral-400 hover:border-neutral-400"}`}
          >
            {t.label} ({orders.filter((o) => {
              if (t.key === "active") return ACTIVE_STATUSES.includes(o.status) && o.status !== "Shipped";
              if (t.key === "shipped") return o.status === "Shipped";
              if (t.key === "done") return DONE_STATUSES.includes(o.status);
              return true;
            }).length})
          </button>
        ))}
      </div>
      <div className="space-y-3">
        {filtered.length === 0 && <p className="text-neutral-500 text-sm">No orders here.</p>}
        {filtered.map((o) => (
          <OrderRow key={o.id} order={o} onUpdateStatus={onUpdateStatus} onDelete={onDelete} />
        ))}
      </div>
    </div>
  );
}

function OrderRow({ order, onUpdateStatus, onDelete }) {
  const [open, setOpen] = useState(false);
  const isDone = DONE_STATUSES.includes(order.status) || order.status === "Shipped";

  function handleDelete(e) {
    e.stopPropagation();
    if (window.confirm(`Delete order #${order.id}? This can't be undone.`)) {
      onDelete(order.id);
    }
  }

  return (
    <div className={`glass p-4 ${isDone ? "opacity-50" : ""}`}>
      <div className="w-full flex items-center justify-between gap-3">
        <button onClick={() => setOpen(!open)} className="flex-1 min-w-0 text-left">
          <p className={`text-sm ${isDone ? "line-through" : ""}`}>#{order.id} — {order.customer.fullName}</p>
          <p className="text-xs text-neutral-500">{new Date(order.createdAt).toLocaleString()} · {fmt(order.total)}</p>
        </button>
        <span className="text-[10px] uppercase tracking-widest border border-neutral-700 px-2 py-1 flex-shrink-0">{order.status}</span>
        <button onClick={handleDelete} className="p-1.5 text-neutral-500 hover:text-white flex-shrink-0 tap-scale" aria-label="Delete order">
          <Trash2 size={15} />
        </button>
      </div>
      {open && (
        <div className="mt-4 pt-4 border-t border-neutral-800 grid sm:grid-cols-2 gap-6">
          <div>
            <h4 className="text-xs uppercase tracking-widest text-neutral-500 mb-2">Customer</h4>
            <p className="text-sm">{order.customer.fullName}</p>
            <p className="text-sm text-neutral-400">{order.customer.phone}</p>
            <p className="text-sm text-neutral-400">{order.customer.address}, {order.customer.city}</p>
            {order.customer.notes && <p className="text-sm text-neutral-500 italic mt-1">"{order.customer.notes}"</p>}

            <h4 className="text-xs uppercase tracking-widest text-neutral-500 mt-4 mb-2">Status</h4>
            <div className="flex flex-wrap gap-1.5">
              {STATUSES.map((s) => (
                <button
                  key={s}
                  onClick={() => onUpdateStatus(order.id, s)}
                  className={`text-[10px] uppercase tracking-widest px-2.5 py-1.5 border ${order.status === s ? "bg-white text-black border-white" : "border-neutral-700 text-neutral-400 hover:border-neutral-400"}`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div>
            <h4 className="text-xs uppercase tracking-widest text-neutral-500 mb-2">Items</h4>
            <div className="space-y-2">
              {order.items.map((it) => (
                <div key={it.key} className="flex justify-between text-sm">
                  <span className="text-neutral-300">{it.name} ({it.color}/{it.size}) × {it.qty}</span>
                  <span>{fmt(it.price * it.qty)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function syncVariants(sizes, colors, existing) {
  const map = {};
  (existing || []).forEach((v) => { map[`${v.size}__${v.color}`] = v.stock; });
  const next = [];
  sizes.forEach((size) => {
    colors.forEach((color) => {
      const key = `${size}__${color}`;
      next.push({ size, color, stock: map[key] !== undefined ? map[key] : 0 });
    });
  });
  return next;
}

function ProductFormModal({ product, onClose, onSave, categories, colors }) {
  const catList = categories && categories.length ? categories : DEFAULT_CATEGORIES;
  const colorList = colors && colors.length ? colors : DEFAULT_COLORS;
  const hexMap = hexMapFrom(colorList);
  const [form, setForm] = useState(() => {
    const base = product
      ? { compareAtPrice: "", styles: [], fabric: "", variants: [], ...product }
      : { name: "", category: catList[0], price: "", compareAtPrice: "", styles: [], fabric: "", description: "", sizes: [], colors: [], variants: [], images: [], isNew: false, isFeatured: false, isBestSeller: false, isSoldOut: false };
    return { ...base, variants: syncVariants(base.sizes, base.colors, base.variants) };
  });
  const [uploading, setUploading] = useState(false);

  const toggleArr = (field, val) => {
    setForm((f) => {
      const nextArr = f[field].includes(val) ? f[field].filter((v) => v !== val) : [...f[field], val];
      const next = { ...f, [field]: nextArr };
      if (field === "sizes" || field === "colors") {
        next.variants = syncVariants(next.sizes, next.colors, f.variants);
      }
      return next;
    });
  };

  function setVariantStock(size, color, stockStr) {
    const stock = Math.max(0, parseInt(stockStr) || 0);
    setForm((f) => ({
      ...f,
      variants: f.variants.map((v) => (v.size === size && v.color === color ? { ...v, stock } : v)),
    }));
  }

  function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement("canvas");
        const maxW = 900;
        const scale = Math.min(1, maxW / image.width);
        canvas.width = image.width * scale;
        canvas.height = image.height * scale;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.75);
        setForm((f) => ({ ...f, images: [...f.images, dataUrl] }));
        setUploading(false);
      };
      image.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }

  function removeImage(i) {
    setForm((f) => ({ ...f, images: f.images.filter((_, idx) => idx !== i) }));
  }

  function handleSubmit() {
    if (!form.name.trim() || !form.price || form.sizes.length === 0 || form.colors.length === 0) {
      alert("Please fill in name, price, and select at least one size and color.");
      return;
    }
    onSave({
      ...form,
      price: parseFloat(form.price),
      compareAtPrice: form.compareAtPrice ? parseFloat(form.compareAtPrice) : null,
      styles: form.styles || [],
      fabric: form.fabric || "",
      variants: form.variants,
      images: form.images.length ? form.images : [img(form.name || "product")],
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black" style={{ opacity: 0.8 }} onClick={onClose} />
      <div
        className="relative bg-black border border-neutral-800 w-full sm:max-w-lg sm:rounded-lg p-6 slide-in-right"
        style={{ maxHeight: "90vh", overflowY: "auto" }}
      >
        <div className="flex items-center justify-between mb-6">
          <h3 className="font-display text-lg tracking-wide">{product ? "Edit Product" : "Add Product"}</h3>
          <button type="button" onClick={onClose}><X size={20} /></button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-xs uppercase tracking-widest text-neutral-500 mb-2 block">Product Name</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full bg-transparent border border-neutral-700 px-3 py-2.5 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs uppercase tracking-widest text-neutral-500 mb-2 block">Price ($)</label>
              <input type="number" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} className="w-full bg-transparent border border-neutral-700 px-3 py-2.5 text-sm" />
            </div>
            <div>
              <label className="text-xs uppercase tracking-widest text-neutral-500 mb-2 block">Fabric / Material</label>
              <input value={form.fabric || ""} onChange={(e) => setForm({ ...form, fabric: e.target.value })} placeholder="e.g. 100% Cotton" className="w-full bg-transparent border border-neutral-700 px-3 py-2.5 text-sm" />
            </div>
          </div>
          <div>
            <label className="text-xs uppercase tracking-widest text-neutral-500 mb-2 block">Compare-at Price ($) — optional, for Sale</label>
            <input
              type="number"
              step="0.01"
              value={form.compareAtPrice || ""}
              onChange={(e) => setForm({ ...form, compareAtPrice: e.target.value })}
              placeholder="Leave empty if not on sale"
              className="w-full bg-transparent border border-neutral-700 px-3 py-2.5 text-sm"
            />
            <p className="text-[10px] text-neutral-600 mt-1">If set higher than the price above, it shows crossed out with a "Sale" badge.</p>
          </div>
          <div>
            <label className="text-xs uppercase tracking-widest text-neutral-500 mb-2 block">Category</label>
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="w-full bg-black border border-neutral-700 px-3 py-2.5 text-sm">
              {catList.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs uppercase tracking-widest text-neutral-500 mb-2 block">Style</label>
            <div className="flex flex-wrap gap-2">
              {STYLES.map((s) => (
                <button key={s} type="button" onClick={() => toggleArr("styles", s)} className={`px-2.5 py-1.5 text-xs border ${(form.styles || []).includes(s) ? "bg-white text-black border-white" : "border-neutral-700 text-neutral-400"}`}>{s}</button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs uppercase tracking-widest text-neutral-500 mb-2 block">Description</label>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} className="w-full bg-transparent border border-neutral-700 px-3 py-2.5 text-sm" />
          </div>
          <div>
            <label className="text-xs uppercase tracking-widest text-neutral-500 mb-2 block">Sizes</label>
            <div className="flex flex-wrap gap-2">
              {ALL_SIZES.map((s) => (
                <button key={s} type="button" onClick={() => toggleArr("sizes", s)} className={`w-9 h-9 text-xs border ${form.sizes.includes(s) ? "bg-white text-black border-white" : "border-neutral-700 text-neutral-400"}`}>{s}</button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs uppercase tracking-widest text-neutral-500 mb-2 block">Colors</label>
            <div className="flex flex-wrap gap-2">
              {colorList.map((c) => (
                <button key={c.name} type="button" onClick={() => toggleArr("colors", c.name)} className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs border ${form.colors.includes(c.name) ? "border-white bg-neutral-900" : "border-neutral-700 text-neutral-400"}`}>
                  <span className="w-3 h-3 rounded-full border border-neutral-600" style={{ background: c.hex }} />{c.name}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-neutral-600 mt-1">Don't see the color you need? Add it from Settings → Catalog first.</p>
          </div>
          {form.sizes.length > 0 && form.colors.length > 0 && (
            <div>
              <label className="text-xs uppercase tracking-widest text-neutral-500 mb-2 block">Stock per Color / Size</label>
              <div className="space-y-1.5 max-h-48 overflow-y-auto border border-neutral-800 p-2">
                {form.variants.map((v) => (
                  <div key={`${v.color}-${v.size}`} className="flex items-center justify-between gap-3 text-xs">
                    <span className="flex items-center gap-1.5 text-neutral-300">
                      <span className="w-2.5 h-2.5 rounded-full border border-neutral-600 flex-shrink-0" style={{ background: hexMap[v.color] }} />
                      {v.color} / {v.size}
                    </span>
                    <input
                      type="number"
                      min="0"
                      value={v.stock}
                      onChange={(e) => setVariantStock(v.size, v.color, e.target.value)}
                      className="w-16 bg-transparent border border-neutral-700 px-2 py-1 text-xs text-right"
                    />
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-neutral-600 mt-1">Total stock: {form.variants.reduce((a, v) => a + (v.stock || 0), 0)}</p>
            </div>
          )}
          <div>
            <label className="text-xs uppercase tracking-widest text-neutral-500 mb-2 block">Product Images</label>
            <div className="flex flex-wrap gap-2 mb-2">
              {form.images.map((im, i) => (
                <div key={i} className="relative w-16 h-20">
                  <img src={im} alt="" className="w-full h-full object-cover" />
                  <button type="button" onClick={() => removeImage(i)} className="absolute -top-1.5 -right-1.5 bg-white text-black rounded-full w-4 h-4 flex items-center justify-center">
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
            <label className="flex items-center gap-2 text-xs text-neutral-400 border border-dashed border-neutral-700 px-3 py-2.5 cursor-pointer w-fit">
              <Upload size={14} /> {uploading ? "Uploading…" : "Upload Image"}
              <input type="file" accept="image/*" onChange={handleFile} className="hidden" />
            </label>
            <p className="text-[10px] text-neutral-600 mt-1">If no image is uploaded, a placeholder will be used.</p>
          </div>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-xs text-neutral-400">
              <input type="checkbox" checked={form.isFeatured} onChange={(e) => setForm({ ...form, isFeatured: e.target.checked })} /> Featured
            </label>
            <label className="flex items-center gap-2 text-xs text-neutral-400">
              <input type="checkbox" checked={form.isNew} onChange={(e) => setForm({ ...form, isNew: e.target.checked })} /> New Arrival
            </label>
            <label className="flex items-center gap-2 text-xs text-neutral-400">
              <input type="checkbox" checked={form.isBestSeller} onChange={(e) => setForm({ ...form, isBestSeller: e.target.checked })} /> Best Seller
            </label>
            <label className="flex items-center gap-2 text-xs text-neutral-400">
              <input type="checkbox" checked={form.isSoldOut} onChange={(e) => setForm({ ...form, isSoldOut: e.target.checked })} /> Sold Out
            </label>
          </div>
        </div>

        <button type="button" onClick={handleSubmit} className="w-full bg-white text-black py-3.5 uppercase tracking-widest text-xs font-semibold mt-6 hover-lift">
          {product ? "Save Changes" : "Add Product"}
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   FOOTER
---------------------------------------------------------------- */

function Footer({ onNavigate }) {
  const clickRef = useRef({ count: 0, timer: null });

  function handleSecretClick() {
    clickRef.current.count += 1;
    clearTimeout(clickRef.current.timer);
    if (clickRef.current.count >= 5) {
      clickRef.current.count = 0;
      onNavigate("admin-login");
      return;
    }
    clickRef.current.timer = setTimeout(() => { clickRef.current.count = 0; }, 1200);
  }

  return (
    <footer className="border-t border-neutral-900 mt-10">
      <div className="max-w-6xl mx-auto px-6 py-14 flex flex-col items-center text-center">
        <Logo size="footer" />
        <p className="text-neutral-500 text-sm max-w-xs mt-6">Premium men&rsquo;s fashion designed for those who never settle.</p>
        <div className="flex items-center gap-5 mt-6">
          <a href={whatsappLink()} target="_blank" rel="noopener noreferrer" className="text-neutral-400 hover:text-white transition-colors" aria-label="WhatsApp">
            <MessageCircle size={20} />
          </a>
          <a href={instagramLink()} target="_blank" rel="noopener noreferrer" className="text-neutral-400 hover:text-white transition-colors" aria-label="Instagram">
            <Instagram size={20} />
          </a>
        </div>
        <div className="flex gap-6 mt-6 text-xs uppercase tracking-widest text-neutral-500">
          <button onClick={() => onNavigate("home")} className="hover:text-white">Home</button>
          <button onClick={() => onNavigate("shop")} className="hover:text-white">Shop</button>
          <button onClick={() => onNavigate("about")} className="hover:text-white">About</button>
        </div>
        <p onClick={handleSecretClick} className="text-neutral-700 text-xs mt-10 select-none cursor-default">
          &copy; {new Date().getFullYear()} Limitless For Men. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
