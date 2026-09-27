KITAWear + Midtrans

1. Upload this folder/ZIP to Netlify.
2. In Netlify: Project configuration > Environment variables, add:
   MIDTRANS_CLIENT_KEY = Client Key dari Midtrans
   MIDTRANS_SERVER_KEY = Server Key dari Midtrans (RAHASIA, jangan taruh di HTML)
   MIDTRANS_IS_PRODUCTION = false untuk Sandbox, true untuk pembayaran nyata.
3. Set variables for Functions/runtime and redeploy after changing them.
4. Test with Sandbox first.
5. For production, switch MIDTRANS_IS_PRODUCTION=true and use Production Client/Server Key.

Payment endpoint: /.netlify/functions/create-transaction
Notification endpoint: /.netlify/functions/midtrans-notification
