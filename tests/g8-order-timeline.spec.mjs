import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
const root=process.cwd();
const read=p=>fs.readFileSync(path.join(root,p),"utf8");

test("G8 order timeline data layer is present and secured",async()=>{
 const files=fs.readdirSync(path.join(root,"supabase","migrations"));
 const mig=files.find(x=>x.includes("g8_order_timeline_shipping_operations"));
 expect(mig).toBeTruthy();
 const sql=read(path.join("supabase","migrations",mig));
 for(const x of ["shipping_tracking_events","shipping_tracking_events_order_idx","alter table public.shipping_tracking_events enable row level security","shipping_tracking_events_buyer_read","get_order_timeline","set search_path=''","revoke execute on function public.get_order_timeline(uuid) from public,anon,authenticated"]) expect(sql).toContain(x);
 const api=read("functions/api/order-timeline.js");
 for(const x of ["/auth/v1/user","get_order_timeline","Akses ditolak","order_id wajib"]) expect(api).toContain(x);
 const webhook=read("functions/api/shipping-webhook.js");
 for(const x of ["shipping_tracking_events","event_key","eventDescription","eventCity"]) expect(webhook).toContain(x);
});

test("G8 buyer order timeline UI is wired",async()=>{
 const index=read("index.html");
 const social=read("social-g3.js");
 const ui=read("order-timeline-g8.js");
 expect(index).toContain('data-order-id="');
 expect(social).toContain("order-timeline-g8.js");
 for(const x of ["/api/order-timeline","Lihat Timeline Lengkap","g8TimelineModal","shipping_events"]) expect(ui).toContain(x);
});
