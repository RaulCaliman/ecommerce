require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Client } = require('pg');
const redis = require('redis');

const app = express();
app.use(cors());
app.use(express.json());

// 1. Connect to PostgreSQL
const pgClient = new Client({
    user: 'postgres',
    host: 'localhost',
    database: 'ecomerce_db',
    password: process.env.DB_PASSWORD,
    port: 5432,
});
pgClient.connect();

// 2. Connect to Redis
const redisClient = redis.createClient({ url: 'redis://localhost:6379' });
redisClient.connect().catch(console.error);

// --- CUSTOMER ROUTES ---

app.get('/api/products', async (req, res) => {
    try {
        const result = await pgClient.query('SELECT * FROM Products ORDER BY ProductID ASC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/cart', async (req, res) => {
    const { productId } = req.body;
    const cartKey = 'cart:user_1';
    try {
        await redisClient.hIncrBy(cartKey, productId.toString(), 1);
        res.json({ message: "Added to cart successfully!" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/checkout', async (req, res) => {
    const userId = 1;
    const cartKey = `cart:user_${userId}`;

    try {
        const cart = await redisClient.hGetAll(cartKey);
        if (Object.keys(cart).length === 0) return res.status(400).json({ error: "Your cart is empty!" });

        await pgClient.query('BEGIN');
        const orderResult = await pgClient.query('INSERT INTO Orders (CustomerID) VALUES ($1) RETURNING OrderID', [userId]);
        const newOrderId = orderResult.rows[0].orderid;

        for (const [productId, quantityStr] of Object.entries(cart)) {
            const quantity = parseInt(quantityStr);
            const productResult = await pgClient.query('SELECT Price, StockCount FROM Products WHERE ProductID = $1 FOR UPDATE', [productId]);
            const product = productResult.rows[0];

            if (product.stockcount < quantity) throw new Error(`Not enough stock for Product ${productId}`);

            await pgClient.query('UPDATE Products SET StockCount = StockCount - $1 WHERE ProductID = $2', [quantity, productId]);
            await pgClient.query('INSERT INTO Order_Items (OrderID, ProductID, Quantity, PurchasePrice) VALUES ($1, $2, $3, $4)', [newOrderId, productId, quantity, product.price]);
        }

        await pgClient.query('COMMIT');
        await redisClient.del(cartKey);
        res.json({ message: `Success! Order #${newOrderId} processed.` });

    } catch (error) {
        await pgClient.query('ROLLBACK');
        res.status(500).json({ error: error.message });
    }
});

// --- ADMIN DASHBOARD ROUTES ---

app.get('/api/admin/revenue', async (req, res) => {
    try {
        const result = await pgClient.query(`
            SELECT c.FullName, SUM(oi.Quantity * oi.PurchasePrice) AS TotalSpent
            FROM Customers c
            JOIN Orders o ON c.CustomerID = o.CustomerID
            JOIN Order_Items oi ON o.OrderID = oi.OrderID
            GROUP BY c.FullName
            ORDER BY TotalSpent DESC;
        `);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/bestsellers', async (req, res) => {
    try {
        const result = await pgClient.query(`
            SELECT p.Name, SUM(oi.Quantity) AS TotalSold
            FROM Products p JOIN Order_Items oi ON p.ProductID = oi.ProductID
            GROUP BY p.Name ORDER BY TotalSold DESC LIMIT 3;
        `);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/lowstock', async (req, res) => {
    try {
        const result = await pgClient.query('SELECT Name, StockCount FROM Products WHERE StockCount <= 5 ORDER BY StockCount ASC;');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 3. START THE SERVER (This is what got deleted!)
app.listen(3000, () => {
    console.log('Backend Server running on http://localhost:3000');
});