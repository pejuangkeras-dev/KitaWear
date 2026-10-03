import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const root=process.cwd();
const read=p=>fs.readFileSync(path.join(root,p),"utf8");

test("G6 loyalty API and UI are wired",async()=>{
  const api=read("functions/api/loyalty.js");
  expect(api).toContain('get_loyalty_summary');
  expect(api).toContain('redeem_loyalty_points');
  expect(api).toContain('Authorization');
  const ui=read("loyalty-g6.js");
  expect(ui).toContain("/api/loyalty");
  expect(ui).toContain("g6Redeem");
  const index=read("index.html");
  expect(index).toContain('id="accountSection-coins"');
  expect(index).toContain('id="g6LoyaltyRoot"');
  const social=read("social-g3.js");
  expect(social).toContain("/loyalty-g6.js");
});
test("G6 loyalty source includes idempotent earning and secure redemption primitives",async()=>{
  const files=fs.readdirSync(path.join(root,"supabase","migrations"));
  const mig=files.find(x=>x.includes("g6_customer_loyalty_rewards"));
  expect(mig).toBeTruthy();
  const sql=read(path.join("supabase","migrations",mig));
  expect(sql).toContain("loyalty_accounts");
  expect(sql).toContain("loyalty_transactions");
  expect(sql).toContain("order:" );
  expect(sql).toContain("redeem_loyalty_points");
  expect(sql).toContain("enable row level security");
});
