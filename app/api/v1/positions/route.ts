import { NextResponse } from "next/server";
import { validateApiKey } from "@/lib/api-auth";
import { getLatestPositions, getPositionsHistory } from "@/lib/redis";
import { fetchItems } from "@/lib/directus";

interface Account {
  id: string;
  name: string;
  symbol: string;
  exchange?: string;
  status: string;
}

/**
 * GET /api/v1/positions
 * Get positions data for accounts
 *
 * Query params:
 * - accountId: specific account ID (optional)
 * - startTime: start timestamp for historical data (optional)
 * - endTime: end timestamp for historical data (optional)
 * - exchange: filter by exchange type (optional)
 */
export async function GET(request: Request) {
  // Validate API key
  if (!validateApiKey(request)) {
    return new Response(
      JSON.stringify({
        error: "Unauthorized",
        message: "Valid API key required. Include 'x-api-key' header.",
      }),
      {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const accountId = searchParams.get("accountId");
    const startTime = searchParams.get("startTime")
      ? parseInt(searchParams.get("startTime")!)
      : undefined;
    const endTime = searchParams.get("endTime")
      ? parseInt(searchParams.get("endTime")!)
      : undefined;
    const exchangeFilter = searchParams.get("exchange");

    // If specific account requested
    if (accountId) {
      if (startTime && endTime) {
        // Get historical data
        const history = await getPositionsHistory(
          accountId,
          startTime,
          endTime
        );
        return NextResponse.json({
          accountId,
          type: "historical",
          count: history.length,
          data: history,
        });
      } else {
        // Get latest data
        const latest = await getLatestPositions(accountId);
        return NextResponse.json({
          accountId,
          type: "latest",
          data: latest,
        });
      }
    }

    // Get all accounts
    const accounts = await fetchItems<Account[]>("trading_accounts", {
      filter: { status: { _eq: "active" } },
      limit: -1,
      fields: ["id", "name", "symbol", "exchange"],
    });

    // Filter by exchange if specified
    const filteredAccounts = exchangeFilter
      ? accounts.filter((acc) => (acc.exchange || "okx") === exchangeFilter)
      : accounts;

    // Get latest positions for all accounts
    const results = await Promise.all(
      filteredAccounts.map(async (account) => {
        const positions = await getLatestPositions(account.id);
        return {
          accountId: account.id,
          accountName: account.name,
          symbol: account.symbol,
          exchange: account.exchange || "okx",
          positions: positions?.data || null,
          timestamp: positions?.timestamp || null,
        };
      })
    );

    return NextResponse.json({
      type: "all",
      count: results.length,
      accounts: results,
    });
  } catch (error: any) {
    console.error("[API] Error fetching positions:", error);
    return NextResponse.json(
      {
        error: "Internal Server Error",
        message: error.message,
      },
      { status: 500 }
    );
  }
}
