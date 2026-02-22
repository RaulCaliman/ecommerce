const redis = require('redis');


const redisClient = redis.createClient({
    url: 'redis://localhost:6379'
});

redisClient.on('error', (err) => console.log('Redis Client Error', err));

async function initializeRedis() {
    await redisClient.connect();
    console.log('Connected to Redis!');
}


async function addToCart(userId, productId, quantity) {
    const cartKey = `cart:user_${userId}`;

    try {

        await redisClient.hSet(cartKey, productId.toString(), quantity.toString());


        await redisClient.expire(cartKey, 86400);

        console.log(`Added Product ${productId} to ${cartKey}.`);
        

        const currentCart = await redisClient.hGetAll(cartKey);
        console.log("Current Cart Contents:", currentCart);

    } catch (error) {
        console.error("Failed to add to cart:", error);
    }
}


 initializeRedis().then(() => addToCart(1, 3, 2));