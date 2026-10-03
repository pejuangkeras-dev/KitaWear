import { onRequest as shippingWebhook } from "./shipping-webhook.js";
export async function onRequest(context){ return shippingWebhook(context); }
