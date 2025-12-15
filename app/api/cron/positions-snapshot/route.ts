import { NextResponse } from "next/server";
import { fetchItems } from "@/lib/directus";
import { OKXClient } from "@/lib/okx";
import { AsterdexClient } from "@/lib/asterdex";
import {
  storePositionsSnapshot,
  storeOrdersSnapshot,
  storeTradeHistorySnapshot,
} from "@/lib/redis";

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

    console.log("[Cron] Starting positions snapshot job");

    const accounts = await fetchItems<Account[]>("trading_accounts", {
      filter: { status: { _eq: "active" } },
      limit: -1,
      fields: ["*"],
    });

    console.log(`[Cron] Found ${accounts.length} accounts to process`);

    const results = [];

    for (const account of accounts) {
      try {
        const exchange = account.exchange || "okx";
        const apiKey = account.api_key || process.env.OKX_API_KEY;
        const apiSecret = account.api_secret || process.env.OKX_API_SECRET;
        const passphrase = account.api_passphrase || process.env.OKX_PASSPHRASE;

        if (exchange === "asterdex") {
          if (!apiKey || !apiSecret) {
            console.log(
              `[Cron] Skipping ${account.name}: Missing API credentials`
            );
            continue;
          }

          const asterdex = new AsterdexClient(apiKey, apiSecret, true);

          // Fetch positions (no symbol parameter to get ALL positions)
          const positionsResponse = await asterdex.getPositions();
          const positions = Array.isArray(positionsResponse)
            ? positionsResponse
            : positionsResponse?.data || [];

          // Fetch pending orders (no symbol parameter to get ALL orders)
          const ordersResponse = await asterdex.getPendingOrders();
          const orders = Array.isArray(ordersResponse)
            ? ordersResponse
            : ordersResponse?.data || [];

          // Fetch trade history for the last 7 days - ONLY for the account's configured symbol
          const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
          const endTime = Date.now();
          const startTime = endTime - SEVEN_DAYS_MS;

          const allTrades: any[] = [];
          const allIncome: any[] = [];

          // Only fetch trade history for the account's configured symbol
          if (account.symbol) {
            try {
              const trades = await asterdex.getUserTrades(
                account.symbol,
                startTime,
                endTime,
                1000
              );
              allTrades.push(
                ...(Array.isArray(trades) ? trades : trades?.data || [])
              );

              // Add small delay to avoid rate limiting
              await new Promise((resolve) => setTimeout(resolve, 200));

              const income = await asterdex.getIncomeHistory(
                account.symbol,
                "REALIZED_PNL",
                startTime,
                endTime,
                1000
              );
              allIncome.push(
                ...(Array.isArray(income) ? income : income?.data || [])
              );

              console.log(
                `[Cron] Fetched ${allTrades.length} trades and ${allIncome.length} income records for ${account.symbol}`
              );
            } catch (error: any) {
              console.error(
                `[Cron] Error fetching trades for ${account.symbol}:`,
                error.message
              );
              console.error(
                `[Cron] Error details:`,
                error.response?.data || error
              );
            }
          }

          // Store in Redis with raw data
          await storePositionsSnapshot(account.id, {
            exchange: "asterdex",
            symbol: account.symbol,
            positions,
            raw: positionsResponse,
          });

          await storeOrdersSnapshot(account.id, {
            exchange: "asterdex",
            symbol: account.symbol,
            orders,
            raw: ordersResponse,
          });

          await storeTradeHistorySnapshot(account.id, {
            exchange: "asterdex",
            symbol: account.symbol,
            trades: allTrades,
            income: allIncome,
            fetchedAt: endTime,
            startTime,
            endTime,
          });

          results.push({
            accountId: account.id,
            accountName: account.name,
            exchange: "asterdex",
            positionsCount: positions.length,
            ordersCount: orders.length,
            tradesCount: allTrades.length,
            incomeCount: allIncome.length,
            success: true,
          });

          console.log(
            `[Cron] ✓ ${account.name} (asterdex): ${positions.length} positions, ${orders.length} orders, ${allTrades.length} trades, ${allIncome.length} income`
          );
        } else {
          // OKX
          if (!apiKey || !apiSecret || !passphrase) {
            console.log(
              `[Cron] Skipping ${account.name}: Missing API credentials`
            );
            continue;
          }

          const okx = new OKXClient(apiKey, apiSecret, passphrase);

          // Fetch positions
          const positionsResponse = await okx.getPositions("SWAP");
          const positions =
            positionsResponse.code === "0" && positionsResponse.data
              ? positionsResponse.data.filter(
                  (pos: any) =>
                    pos.instId === account.symbol &&
                    Math.abs(Number(pos.pos)) > 0
                )
              : [];

          // Fetch pending orders
          const ordersResponse = await okx.getPendingOrders(
            "SWAP",
            account.symbol
          );
          const orders =
            ordersResponse.code === "0" && ordersResponse.data
              ? ordersResponse.data
              : [];

          // Store in Redis with raw data
          await storePositionsSnapshot(account.id, {
            exchange: "okx",
            symbol: account.symbol,
            positions,
            raw: positionsResponse,
          });

          await storeOrdersSnapshot(account.id, {
            exchange: "okx",
            symbol: account.symbol,
            orders,
            raw: ordersResponse,
          });

          results.push({
            accountId: account.id,
            accountName: account.name,
            exchange: "okx",
            positionsCount: positions.length,
            ordersCount: orders.length,
            success: true,
          });

          console.log(
            `[Cron] ✓ ${account.name} (okx): ${positions.length} positions, ${orders.length} orders`
          );
        }
      } catch (error: any) {
        console.error(
          `[Cron] Error processing ${account.name}:`,
          error.message
        );
        console.error(`[Cron] Error details for ${account.name}:`, {
          status: error.response?.status,
          statusText: error.response?.statusText,
          data: error.response?.data,
          message: error.message,
        });
        results.push({
          accountId: account.id,
          accountName: account.name,
          error: error.message,
          errorDetails: error.response?.data || error.message,
          success: false,
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;

    console.log(
      `[Cron] Completed: ${successCount} successful, ${failCount} failed`
    );

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      summary: {
        total: accounts.length,
        successful: successCount,
        failed: failCount,
      },
      results,
    });
  } catch (error: any) {
    console.error("[Cron] Fatal error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
