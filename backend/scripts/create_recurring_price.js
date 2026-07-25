require('dotenv').config({ path: '../.env' });
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

async function createRecurringPrice() {
    try {
        const product = 'prod_Tekwu2aFnUYj02'; // The Growth Product ID we created earlier

        const price = await stripe.prices.create({
            unit_amount: 100, // $1.00
            currency: 'usd',
            recurring: {
                interval: 'month',
            },
            product: product,
            nickname: 'Growth Plan ($1/mo)',
        });

        console.log('Created Recurring Price:', price.id);
    } catch (error) {
        console.error('Error creating price:', error);
    }
}

createRecurringPrice();
