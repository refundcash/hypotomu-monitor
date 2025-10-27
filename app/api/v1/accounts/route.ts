import { NextResponse } from "next/server";
import { validateApiKey } from "@/lib/api-auth";
import { fetchItems } from "@/lib/directus";

interface Account {
  id: string;
  name: string;
  symbol: string;
  exchange?: string;
  status: string;
}

/**
 * GET /api/v1/accounts
 * Get list of all trading accounts
 *
 * Query params:
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
    const exchangeFilter = searchParams.get("exchange");

    // Get all accounts
    const accounts = await fetchItems<Account[]>("trading_accounts", {
      filter: { status: { _eq: "active" } },
      limit: -1,
      fields: ["id", "name", "symbol", "exchange", "status"],
    });

    // Filter by exchange if specified
    const filteredAccounts = exchangeFilter
      ? accounts.filter((acc) => (acc.exchange || "okx") === exchangeFilter)
      : accounts;

    return NextResponse.json({
      count: filteredAccounts.length,
      accounts: filteredAccounts.map((acc) => ({
        id: acc.id,
        name: acc.name,
        symbol: acc.symbol,
        exchange: acc.exchange || "okx",
      })),
    });
  } catch (error: any) {
    console.error("[API] Error fetching accounts:", error);
    return NextResponse.json(
      {
        error: "Internal Server Error",
        message: error.message,
      },
      { status: 500 }
    );
  }
}
