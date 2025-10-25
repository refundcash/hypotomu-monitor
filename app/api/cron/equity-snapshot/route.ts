import { NextResponse } from "next/server";
import { fetchItems } from "@/lib/directus";
import { OKXClient } from "@/lib/okx";
import { storeEquitySnapshot } from "@/lib/redis";

interface Account {
  id: string;
  name: string;
  symbol: string;
  api_key?: string;
  api_secret?: string;
  passphrase?: string;
  status: string;
}

async function getAccountBalance(okx: OKXClient) {
  try {
    const response = await okx.getAccountBalance();
    if (response.code === "0" && response.data && response.data.length > 0) {
      const accountData = response.data[0];
      return {
        totalEquity: Number(accountData.totalEq || 0),
      };
    }
    return null;
  } catch (error) {
    console.error("Error getting balance:", error);
    return null;
  }
}

export async function GET(request: Request) {
  try {
    // Verify this is a legitimate cron request
    // Vercel cron sends a special header for authentication
    const authHeader = request.headers.get("authorization");
    const cronHeader = request.headers.get("x-vercel-cron-id");

    // Allow if:
    // 1. Has valid CRON_SECRET header, OR
    // 2. Has Vercel cron header (in production), OR
    // 3. Running in development mode
    const isAuthorized =
      authHeader === `Bearer ${process.env.CRON_SECRET}` ||
      (cronHeader && process.env.NODE_ENV === "production") ||
      process.env.NODE_ENV !== "production";

    if (!isAuthorized) {
      console.log("[Cron] Unauthorized request");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const accounts = await fetchItems<Account[]>("mm_trading_accounts", {
      filter: { status: { _eq: "published" } },
      limit: -1,
      fields: ["*"],
    });

    const results = [];

    for (const account of accounts) {
      try {
        const apiKey = account.api_key || process.env.OKX_API_KEY;
        const apiSecret = account.api_secret || process.env.OKX_API_SECRET;
        const passphrase = account.passphrase || process.env.OKX_PASSPHRASE;

        if (!apiKey || !apiSecret || !passphrase) {
          console.log(`[CRON] Skipping ${account.name}: Missing API credentials`);
          results.push({
            accountId: account.id,
            accountName: account.name,
            status: "skipped",
            reason: "Missing credentials",
          });
          continue;
        }

        const okx = new OKXClient(apiKey, apiSecret, passphrase);
        const balance = await getAccountBalance(okx);

        if (balance) {
          await storeEquitySnapshot(account.id, balance.totalEquity);
          console.log(`[CRON] Stored equity snapshot for ${account.name}: $${balance.totalEquity.toFixed(2)}`);
          results.push({
            accountId: account.id,
            accountName: account.name,
            status: "success",
            equity: balance.totalEquity,
          });
        } else {
          console.log(`[CRON] Failed to get balance for ${account.name}`);
          results.push({
            accountId: account.id,
            accountName: account.name,
            status: "failed",
            reason: "Failed to get balance",
          });
        }
      } catch (error: any) {
        console.error(`[CRON] Error processing ${account.name}:`, error.message);
        results.push({
          accountId: account.id,
          accountName: account.name,
          status: "error",
          error: error.message,
        });
      }
    }

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      totalAccounts: accounts.length,
      results,
    });
  } catch (error: any) {
    console.error("[CRON] Fatal error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
