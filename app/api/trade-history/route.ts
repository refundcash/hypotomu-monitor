import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { fetchItems } from "@/lib/directus";
import { AsterdexClient } from "@/lib/asterdex";

interface Account {
  id: string;
  name: string;
  symbol: string;
  api_key?: string;
  api_secret?: string;
  exchange?: string;
  status: string;
}

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const accountId = searchParams.get("accountId");
    const symbol = searchParams.get("symbol") || undefined;
    const startTime = searchParams.get("startTime")
      ? parseInt(searchParams.get("startTime")!)
      : undefined;
    const endTime = searchParams.get("endTime")
      ? parseInt(searchParams.get("endTime")!)
      : undefined;
    const limit = searchParams.get("limit")
      ? parseInt(searchParams.get("limit")!)
      : 100;

    if (!accountId) {
      return NextResponse.json(
        { error: "accountId is required" },
        { status: 400 }
      );
    }

    const account = await fetchItems<Account>("mm_trading_accounts", {
      filter: { id: { _eq: accountId }, status: { _eq: "published" } },
      limit: 1,
      fields: ["*"],
    });

    if (!account) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    const exchange = account.exchange || "okx";

    if (exchange !== "asterdex") {
      return NextResponse.json(
        { error: "Only Asterdex accounts are supported" },
        { status: 400 }
      );
    }

    const apiKey = account.api_key;
    const apiSecret = account.api_secret;

    if (!apiKey || !apiSecret) {
      return NextResponse.json(
        { error: "Missing API credentials" },
        { status: 400 }
      );
    }

    const asterdex = new AsterdexClient(apiKey, apiSecret, true);

    // Use the account's symbol or the symbol from query params
    const tradeSymbol = symbol || account.symbol;

    if (!tradeSymbol) {
      return NextResponse.json(
        { error: "Symbol is required" },
        { status: 400 }
      );
    }

    // Asterdex API has a maximum time interval of 7 days
    // We need to fetch data in 7-day chunks
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    const allTrades: any[] = [];
    const allIncome: any[] = [];

    const requestedStartTime = startTime || Date.now() - SEVEN_DAYS_MS;
    const requestedEndTime = endTime || Date.now();

    // Split the time range into 7-day chunks
    let currentStart = requestedStartTime;
    while (currentStart < requestedEndTime) {
      const currentEnd = Math.min(currentStart + SEVEN_DAYS_MS, requestedEndTime);

      try {
        // Get trade history for this chunk
        const chunkTrades = await asterdex.getUserTrades(
          tradeSymbol,
          currentStart,
          currentEnd,
          1000
        );
        allTrades.push(...(Array.isArray(chunkTrades) ? chunkTrades : chunkTrades?.data || []));

        // Get income history for this chunk
        const chunkIncome = await asterdex.getIncomeHistory(
          tradeSymbol,
          "REALIZED_PNL",
          currentStart,
          currentEnd,
          1000
        );
        allIncome.push(...(Array.isArray(chunkIncome) ? chunkIncome : chunkIncome?.data || []));
      } catch (error: any) {
        console.error(`Error fetching chunk ${currentStart}-${currentEnd}:`, error.message);
        // Continue with next chunk even if one fails
      }

      currentStart = currentEnd;
    }

    // Get current positions for active trades
    const positions = await asterdex.getPositions(tradeSymbol);

    return NextResponse.json({
      accountId: account.id,
      accountName: account.name || account.id,
      exchange: "asterdex",
      trades: allTrades,
      income: allIncome,
      positions: Array.isArray(positions) ? positions : positions?.data || [],
    });
  } catch (error: any) {
    console.error("Error fetching trade history:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch trade history" },
      { status: 500 }
    );
  }
}
