const { Client } = require('pg');
const redis = require('redis');

// 1. Configure Database Connections
const pgClient = new Client({
    user: 'postgres',
    host: 'localhost',
    database: 'ecomerce_db',
    password: 'Motoroz@4361',
    port: 5432,
});

const redisClient = redis.createClient({ url: 'redis://localhost:6379' });

async function processCheckout(userId) {
    await pgClient.connect();
    await redisClient.connect();

    const cartKey = `cart:user_${userId}`;
    
    try {
        // 2. Fetch the cart from Redis
        const cart = await redisClient.hGetAll(cartKey);
        if (Object.keys(cart).length === 0) {
            console.log("Cart is empty. Nothing to checkout.");
            return;
        }

        console.log(`Starting checkout for User ${userId}...`);

        // 3. START THE TRANSACTION
        await pgClient.query('BEGIN');

        // 4. Create the Order record
      
        const orderResult = await pgClient.query(
            'INSERT INTO Orders (CustomerID) VALUES ($1) RETURNING OrderID',
            [userId]
        );

        const newOrderId = orderResult.rows[0].orderid; 

        // 5. Loop through the Redis cart to process each item
        for (const [productId, quantityStr] of Object.entries(cart)) {
            const quantity = parseInt(quantityStr);

            // 6. THE LOCK: Check stock and lock the row so nobody else can buy it right now
            const productResult = await pgClient.query(
                'SELECT Price, StockCount FROM Products WHERE ProductID = $1 FOR UPDATE',
                [productId]
            );

            const product = productResult.rows[0];

            // 7. Verify we have enough stock
            if (product.stockcount < quantity) {
                // If this throws, the catch block catches it and rolls EVERYTHING back
                throw new Error(`Insufficient stock for Product ${productId}. Checkout failed.`);
            }

            // 8. Deduct the stock
            await pgClient.query(
                'UPDATE Products SET StockCount = StockCount - $1 WHERE ProductID = $2',
                [quantity, productId]
            );

            // 9. Write the receipt line item
            await pgClient.query(
                'INSERT INTO Order_Items (OrderID, ProductID, Quantity, PurchasePrice) VALUES ($1, $2, $3, $4)',
                [newOrderId, productId, quantity, product.price]
            );
        }

        // 10. SUCCESS! Save everything to the hard drive permanently.
        await pgClient.query('COMMIT');
        
        // 11. Clear the temporary Redis cart
        await redisClient.del(cartKey);
        console.log(`Success! Order #${newOrderId} has been processed.`);

    } catch (error) {
        // 12. FAILURE! Cancel the entire process. No stock is deducted, no order is saved.
        await pgClient.query('ROLLBACK');
        console.error("Transaction rolled back due to error:", error.message);
    } finally {
        await pgClient.end();
        await redisClient.disconnect();
    }
}


processCheckout(1);