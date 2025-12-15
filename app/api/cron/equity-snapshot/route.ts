import { NextResponse } from "next/server";
import { fetchItems } from "@/lib/directus";
import { OKXClient } from "@/lib/okx";
import { AsterdexClient } from "@/lib/asterdex";
import { storeEquitySnapshot } from "@/lib/redis";

interface Account {
  id: string;
  name: string;
  symbol: string;
  api_key?: string;
  api_secret?: string;
  api_passphrase?: string;
  exchange?: string;
  status: string;
}

async function getOKXAccountBalance(okx: OKXClient) {
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
    console.error("Error getting OKX balance:", error);
    return null;
  }
}

async function getAsterdexAccountBalance(asterdex: AsterdexClient) {
  try {
    const balanceResponse = await asterdex.getAccountBalance();
    const balances = Array.isArray(balanceResponse)
      ? balanceResponse
      : balanceResponse?.data || [];
    const usdtBalance = balances.find(
      (b: any) => b.asset === "USDT" || b.a === "USDT"
    );

    const totalEquity = Number(
      usdtBalance?.balance || usdtBalance?.wb || usdtBalance?.walletBalance || 0
    );

    return {
      totalEquity: totalEquity,
    };
  } catch (error) {
    console.error("Error getting Asterdex balance:", error);
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

    const accounts = await fetchItems<Account[]>("trading_accounts", {
      filter: { status: { _eq: "active" } },
      limit: -1,
      fields: ["*"],
    });

    const results = [];

    for (const account of accounts) {
      try {
        const exchange = account.exchange || "okx";
        const apiKey = account.api_key || process.env.OKX_API_KEY;
        const apiSecret = account.api_secret || process.env.OKX_API_SECRET;
        const passphrase = account.api_passphrase || process.env.OKX_PASSPHRASE;

        let balance = null;

        if (exchange === "asterdex") {
          // Asterdex - only needs API key and secret
          if (!apiKey || !apiSecret) {
            console.log(
              `[CRON] Skipping ${account.name}: Missing Asterdex API credentials`
            );
            results.push({
              accountId: account.id,
              accountName: account.name,
              exchange: "asterdex",
              status: "skipped",
              reason: "Missing credentials",
            });
            continue;
          }

          const asterdex = new AsterdexClient(apiKey, apiSecret, true);
          balance = await getAsterdexAccountBalance(asterdex);
        } else {
          // OKX - needs API key, secret, and passphrase
          if (!apiKey || !apiSecret || !passphrase) {
            console.log(
              `[CRON] Skipping ${account.name}: Missing OKX API credentials`
            );
            results.push({
              accountId: account.id,
              accountName: account.name,
              exchange: "okx",
              status: "skipped",
              reason: "Missing credentials",
            });
            continue;
          }

          const okx = new OKXClient(apiKey, apiSecret, passphrase);
          balance = await getOKXAccountBalance(okx);
        }

        if (balance) {
          await storeEquitySnapshot(account.id, balance.totalEquity);
          console.log(
            `[CRON] Stored equity snapshot for ${account.name} (${exchange}): $${balance.totalEquity.toFixed(2)}`
          );
          results.push({
            accountId: account.id,
            accountName: account.name,
            exchange: exchange,
            status: "success",
            equity: balance.totalEquity,
          });
        } else {
          console.log(`[CRON] Failed to get balance for ${account.name} (${exchange})`);
          results.push({
            accountId: account.id,
            accountName: account.name,
            exchange: exchange,
            status: "failed",
            reason: "Failed to get balance",
          });
        }
      } catch (error: any) {
        console.error(
          `[CRON] Error processing ${account.name}:`,
          error.message
        );
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
