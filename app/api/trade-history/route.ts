import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { fetchItems } from "@/lib/directus";
import { AsterdexClient } from "@/lib/asterdex";
import { validateApiKey } from "@/lib/api-auth";
import { getLatestTradeHistory } from "@/lib/redis";

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
    // Check for either NextAuth session OR API key
    const session = await getServerSession(authOptions);
    const hasValidApiKey = validateApiKey(request);

    if (!session && !hasValidApiKey) {
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

    // Asterdex API has a maximum time interval of 7 days
    // We need to fetch data in 7-day chunks
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    let allTrades: any[] = [];
    let allIncome: any[] = [];
    let positions: any[] = [];

    const requestedStartTime = startTime || Date.now() - SEVEN_DAYS_MS;
    const requestedEndTime = endTime || Date.now();

    // Try to get data from Redis first
    const cachedData = await getLatestTradeHistory(accountId);

    if (cachedData && cachedData.data) {
      const { data } = cachedData;
      console.log(`[TradeHistory] Using cached data from Redis for account ${accountId}`);

      // Filter trades by time range if specified
      let filteredTrades = data.trades || [];
      let filteredIncome = data.income || [];

      if (startTime || endTime) {
        filteredTrades = filteredTrades.filter((trade: any) => {
          const tradeTime = trade.time || trade.timestamp;
          if (startTime && tradeTime < startTime) return false;
          if (endTime && tradeTime > endTime) return false;
          return true;
        });

        filteredIncome = filteredIncome.filter((inc: any) => {
          const incTime = inc.time || inc.timestamp;
          if (startTime && incTime < startTime) return false;
          if (endTime && incTime > endTime) return false;
          return true;
        });
      }

      // Filter by symbol if specified
      if (tradeSymbol) {
        filteredTrades = filteredTrades.filter((trade: any) => trade.symbol === tradeSymbol);
        filteredIncome = filteredIncome.filter((inc: any) => inc.symbol === tradeSymbol);
      }

      // Get current positions
      const positionsResponse = await asterdex.getPositions(tradeSymbol);
      positions = Array.isArray(positionsResponse) ? positionsResponse : positionsResponse?.data || [];

      return NextResponse.json({
        accountId: account.id,
        accountName: account.name || account.id,
        exchange: "asterdex",
        trades: filteredTrades,
        income: filteredIncome,
        positions,
        source: "redis",
        cachedAt: cachedData.timestamp,
      });
    }

    console.log(`[TradeHistory] No cached data found, fetching from API for account ${accountId}`);

    // Determine which symbols to fetch
    let symbolsToFetch: string[] = [];

    if (tradeSymbol) {
      // If symbol is specified, only fetch for that symbol
      symbolsToFetch = [tradeSymbol];
    } else {
      // If no symbol specified, get all positions and extract unique symbols
      const allPositions = await asterdex.getPositions();
      const positionsArray = Array.isArray(allPositions) ? allPositions : allPositions?.data || [];

      // Extract unique symbols from positions
      const positionSymbols = positionsArray
        .filter((pos: any) => parseFloat(pos.positionAmt || 0) !== 0)
        .map((pos: any) => pos.symbol);

      // Also fetch income history without symbol filter to get all traded symbols
      const allIncomeData = await asterdex.getIncomeHistory(
        undefined,
        "REALIZED_PNL",
        requestedStartTime,
        requestedEndTime,
        1000
      );
      const incomeArray = Array.isArray(allIncomeData) ? allIncomeData : allIncomeData?.data || [];
      const incomeSymbols = incomeArray.map((inc: any) => inc.symbol);

      // Combine and deduplicate symbols
      symbolsToFetch = [...new Set([...positionSymbols, ...incomeSymbols])];

      // If account has a specific symbol, ensure it's included
      if (account.symbol) {
        symbolsToFetch = [...new Set([...symbolsToFetch, account.symbol])];
      }

      if (symbolsToFetch.length === 0) {
        // No positions or income found, return empty results
        return NextResponse.json({
          accountId: account.id,
          accountName: account.name || account.id,
          exchange: "asterdex",
          trades: [],
          income: [],
          positions: [],
          source: "api",
        });
      }
    }

    // Fetch trades and income for each symbol
    for (const symbolItem of symbolsToFetch) {
      // Split the time range into 7-day chunks
      let currentStart = requestedStartTime;
      while (currentStart < requestedEndTime) {
        const currentEnd = Math.min(currentStart + SEVEN_DAYS_MS, requestedEndTime);

        try {
          // Get trade history for this chunk
          const chunkTrades = await asterdex.getUserTrades(
            symbolItem,
            currentStart,
            currentEnd,
            1000
          );
          allTrades.push(...(Array.isArray(chunkTrades) ? chunkTrades : chunkTrades?.data || []));

          // Get income history for this chunk
          const chunkIncome = await asterdex.getIncomeHistory(
            symbolItem,
            "REALIZED_PNL",
            currentStart,
            currentEnd,
            1000
          );
          allIncome.push(...(Array.isArray(chunkIncome) ? chunkIncome : chunkIncome?.data || []));
        } catch (error: any) {
          console.error(`Error fetching chunk for ${symbolItem} ${currentStart}-${currentEnd}:`, error.message);
          // Continue with next chunk even if one fails
        }

        currentStart = currentEnd;
      }
    }

    // Get current positions for active trades
    const positionsResponse = await asterdex.getPositions(tradeSymbol);
    positions = Array.isArray(positionsResponse) ? positionsResponse : positionsResponse?.data || [];

    return NextResponse.json({
      accountId: account.id,
      accountName: account.name || account.id,
      exchange: "asterdex",
      trades: allTrades,
      income: allIncome,
      positions,
      source: "api",
    });
  } catch (error: any) {
    console.error("Error fetching trade history:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch trade history" },
      { status: 500 }
    );
  }
}
