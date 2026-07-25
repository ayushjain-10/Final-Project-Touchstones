require('dotenv').config({ path: '../.env' });
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

async function updateProduct() {
    const productId = 'prod_Tekwu2aFnUYj02'; // "Growth" Product ID

    try {
        const product = await stripe.products.update(productId, {
            description: 'For growing teams hiring continuously. Includes 10 Job Postings, 1,000 AI Screens, and ATS Integrations.',
            // images: ['https://your-domain.com/logo.png'], // User needs to set this in Dashboard or provide a URL
        });

        console.log('Product updated:', product.name);
        console.log('New Description:', product.description);
    } catch (error) {
        console.error('Error updating product:', error);
    }
}

updateProduct();
