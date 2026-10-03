import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
const root=process.cwd();
const read=p=>fs.readFileSync(path.join(root,p),"utf8");

test("G7 communication center is hardened",async()=>{
 const files=fs.readdirSync(path.join(root,"supabase","migrations"));
 const mig=files.find(x=>x.includes("g7_communication_center_hardening"));
 expect(mig).toBeTruthy();
 const sql=read(path.join("supabase","migrations",mig));
 for(const x of ["chat_messages_send","sender_id=auth.uid()","get_chat_unread_count","get_chat_threads","notifications_user_unread_idx"]) expect(sql).toContain(x);
 const dedup=files.find(x=>x.includes("g7_chat_notification_dedup_preferences"));
 expect(dedup).toBeTruthy();
 const dsql=read(path.join("supabase","migrations",dedup));
 for(const x of ["notification_preferences","chat_messages","left(new.body,180)","drop trigger if exists trg_g7_chat_message_notify"]) expect(dsql).toContain(x);
});
test("G7 buyer/seller chat surfaces exist",async()=>{
 const index=read("index.html"),seller=read("seller.html");
 for(const x of ["accountSection-messages","buyerChatInbox","sendBuyerChatMessage","open_chat_thread"]) expect(index).toContain(x);
 for(const x of ["sellerChatThreads","sendSellerChat","seller-chat-"]) expect(seller).toContain(x);
});
