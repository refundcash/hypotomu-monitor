import { NextResponse } from "next/server";
import { fetchItems } from "@/lib/directus";
import { OKXClient } from "@/lib/okx";
import { AsterdexClient } from "@/lib/asterdex";
import { storePositionsSnapshot, storeOrdersSnapshot } from "@/lib/redis";

interface Account {
  id: string;
  name: string;
  symbol: string;
  api_key?: string;
  api_secret?: string;
  passphrase?: string;
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

    const accounts = await fetchItems<Account[]>("mm_trading_accounts", {
      filter: { status: { _eq: "published" } },
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
        const passphrase = account.passphrase || process.env.OKX_PASSPHRASE;

        if (exchange === "asterdex") {
          if (!apiKey || !apiSecret) {
            console.log(`[Cron] Skipping ${account.name}: Missing API credentials`);
            continue;
          }

          const asterdex = new AsterdexClient(apiKey, apiSecret, true);

          // Fetch positions
          const positionsResponse = await asterdex.getPositions(account.symbol);
          const positions = Array.isArray(positionsResponse)
            ? positionsResponse
            : positionsResponse?.data || [];

          // Fetch pending orders
          const ordersResponse = await asterdex.getPendingOrders(account.symbol);
          const orders = Array.isArray(ordersResponse)
            ? ordersResponse
            : ordersResponse?.data || [];

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

          results.push({
            accountId: account.id,
            accountName: account.name,
            exchange: "asterdex",
            positionsCount: positions.length,
            ordersCount: orders.length,
            success: true,
          });

          console.log(
            `[Cron] ✓ ${account.name} (asterdex): ${positions.length} positions, ${orders.length} orders`
          );
        } else {
          // OKX
          if (!apiKey || !apiSecret || !passphrase) {
            console.log(`[Cron] Skipping ${account.name}: Missing API credentials`);
            continue;
          }

          const okx = new OKXClient(apiKey, apiSecret, passphrase);

          // Fetch positions
          const positionsResponse = await okx.getPositions("SWAP");
          const positions =
            positionsResponse.code === "0" && positionsResponse.data
              ? positionsResponse.data.filter(
                  (pos: any) =>
                    pos.instId === account.symbol && Math.abs(Number(pos.pos)) > 0
                )
              : [];

          // Fetch pending orders
          const ordersResponse = await okx.getPendingOrders("SWAP", account.symbol);
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
        console.error(`[Cron] Error processing ${account.name}:`, error.message);
        results.push({
          accountId: account.id,
          accountName: account.name,
          error: error.message,
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
