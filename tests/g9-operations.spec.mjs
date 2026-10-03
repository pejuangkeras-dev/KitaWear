import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
const root=process.cwd();const read=p=>fs.readFileSync(path.join(root,p),"utf8");
test("Operations Center operations API is admin protected and covers marketplace queues",async()=>{
 const src=read("functions/api/admin-operations.js");
 for(const x of ["LOGIN_REQUIRED","ADMIN_REQUIRED","return_requests","disputes","refund_requests","seller_payout_requests","shipping_shipments","shipping_tracking_events","pending_payout_amount","shipment_exceptions"]) expect(src).toContain(x);
});
test("Operations Center operations center is wired into admin UI",async()=>{
 const html=read("admin.html"),ui=read("admin-operations-g9.js");
 for(const x of ["Operations Center · Operations Center","g9OperationsBody","loadOperations CenterOperations","admin-operations.js"]) expect(html).toContain(x);
 for(const x of ["/api/admin-operations","pending_refunds","open_disputes","shipment_exceptions"]) expect(ui).toContain(x);
});
