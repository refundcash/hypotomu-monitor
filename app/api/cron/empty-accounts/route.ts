import { NextResponse } from "next/server";
import { fetchItems, directus } from "@/lib/directus";
import { updateItems, createItems } from "@directus/sdk";
import { OKXClient } from "@/lib/okx";
import { AsterdexClient } from "@/lib/asterdex";

// Default trading symbols to assign
const DEFAULT_TRADING_SYMBOLS = [
  "5a74afe7-5781-4647-b1c2-918837c873b7",
  "cd24ee0a-b666-4178-98e4-e2940c80a9df",
];

// Equity threshold
const EQUITY_THRESHOLD = 500;

interface Account {
  id: string;
  name: string;
  api_key?: string;
  api_secret?: string;
  passphrase?: string;
  exchange?: string;
  status: string;
  trading_symbols?: any[]; // Array of trading symbols
}

async function getOKXAccountBalance(okx: OKXClient) {
  try {
    const response = await okx.getAccountBalance();
    if (response.code === "0" && response.data && response.data.length > 0) {
      const accountData = response.data[0];
      const details = accountData.details?.[0] || {};

      return {
        totalEquity: Number(accountData.totalEq || 0),
        availableBalance: Number(details.availBal || 0),
        frozenBalance: Number(details.frozenBal || 0),
        equity: Number(details.eq || 0),
        upl: Number(accountData.upl || 0),
        isoEq: Number(accountData.isoEq || 0),
        marginFrozen: Number(accountData.mgnRatio || 0),
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
    const availableBalance = Number(
      usdtBalance?.availableBalance ||
        usdtBalance?.ab ||
        usdtBalance?.availBal ||
        0
    );

    return {
      totalEquity: totalEquity,
      availableBalance: availableBalance,
      balanceInUse: totalEquity - availableBalance,
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

    console.log("[CRON] Fetching active accounts with empty trading_symbols...");

    // Fetch all active accounts with trading_symbols field
    const accounts = await fetchItems<Account[]>("trading_accounts", {
      filter: {
        status: { _eq: "active" },
        id: { _neq: "0013f57f-6a3f-42c5-93ab-87b57295bfb9" },
        trading_symbols: {
          _null: true, // Only fetch accounts with null trading_symbols
        },
      },
      limit: -1,
      fields: ["*", "trading_symbols.*"], // Include trading_symbols relation
    });

    console.log(`[CRON] Total active accounts: ${accounts.length}`);

    // Filter accounts with empty trading_symbols
    const emptyAccounts = accounts.filter((account) => {
      const symbols = account.trading_symbols || [];
      return symbols.length === 0;
    });

    console.log(
      `[CRON] Accounts with empty trading_symbols: ${emptyAccounts.length}`
    );

    if (emptyAccounts.length === 0) {
      console.log("[CRON] No accounts with empty trading_symbols found.");
      return NextResponse.json({
        timestamp: new Date().toISOString(),
        totalAccounts: 0,
        successCount: 0,
        errorCount: 0,
        assignedSymbolsCount: 0,
        setInactiveCount: 0,
        updateErrorCount: 0,
        results: [],
      });
    }

    // Fetch equity for each account
    const results = [];

    for (const account of emptyAccounts) {
      console.log(
        `[CRON] Processing account: ${account.name || account.id}`
      );

      const exchange = account.exchange || "okx";
      const apiKey = account.api_key || process.env.OKX_API_KEY;
      const apiSecret = account.api_secret || process.env.OKX_API_SECRET;
      const passphrase = account.passphrase || process.env.OKX_PASSPHRASE;

      let balance = null;

      try {
        if (exchange === "asterdex") {
          if (!apiKey || !apiSecret) {
            console.error(
              `[CRON] Missing API credentials for Asterdex: ${account.name}`
            );
            results.push({
              accountId: account.id,
              accountName: account.name || account.id,
              exchange: "asterdex",
              error: "Missing API credentials",
            });
            continue;
          }

          const asterdex = new AsterdexClient(apiKey, apiSecret, true);
          balance = await getAsterdexAccountBalance(asterdex);
        } else {
          // Default to OKX
          if (!apiKey || !apiSecret || !passphrase) {
            console.error(
              `[CRON] Missing API credentials for OKX: ${account.name}`
            );
            results.push({
              accountId: account.id,
              accountName: account.name || account.id,
              exchange: "okx",
              error: "Missing API credentials",
            });
            continue;
          }

          const okx = new OKXClient(apiKey, apiSecret, passphrase);
          balance = await getOKXAccountBalance(okx);
        }

        if (balance) {
          console.log(
            `[CRON] ${account.name} (${exchange}): Total Equity = $${balance.totalEquity.toFixed(
              2
            )}, Available = $${balance.availableBalance.toFixed(2)}`
          );

          // Check equity threshold and update account accordingly
          const totalEquity = balance.totalEquity;
          let action = "none";
          let updateError = null;

          try {
            if (totalEquity >= EQUITY_THRESHOLD) {
              // Assign default trading symbols
              console.log(
                `[CRON] ${account.name}: Equity >= $${EQUITY_THRESHOLD} - Assigning default trading symbols...`
              );

              // Create junction records for the trading symbols
              const junctionRecords = DEFAULT_TRADING_SYMBOLS.map(
                (symbolId) => ({
                  trading_accounts_id: account.id,
                  trading_symbols_id: symbolId,
                })
              );

              await directus.request(
                createItems("trading_accounts_trading_symbols", junctionRecords)
              );

              action = "assigned_symbols";
              console.log(
                `[CRON] ${account.name}: Successfully assigned ${DEFAULT_TRADING_SYMBOLS.length} trading symbols`
              );
            } else {
              // Set account to inactive with invalid_reason
              console.log(
                `[CRON] ${account.name}: Equity < $${EQUITY_THRESHOLD} - Setting account to inactive...`
              );

              await directus.request(
                updateItems("trading_accounts", [account.id], {
                  status: "inactive",
                  invalid_reason: `Insufficient equity: $${totalEquity.toFixed(
                    2
                  )} (minimum: $${EQUITY_THRESHOLD})`,
                })
              );

              action = "set_inactive";
              console.log(`[CRON] ${account.name}: Account set to inactive`);
            }
          } catch (updateErr: any) {
            console.error(
              `[CRON] ${account.name}: Error updating account: ${updateErr.message}`
            );
            updateError = updateErr.message;
          }

          results.push({
            accountId: account.id,
            accountName: account.name || account.id,
            exchange: exchange,
            balance: balance,
            action: action,
            updateError: updateError,
          });
        } else {
          console.error(
            `[CRON] ${account.name}: Failed to fetch balance`
          );
          results.push({
            accountId: account.id,
            accountName: account.name || account.id,
            exchange: exchange,
            error: "Failed to fetch balance",
          });
        }
      } catch (error: any) {
        console.error(
          `[CRON] ${account.name}: Error: ${error.message}`
        );
        results.push({
          accountId: account.id,
          accountName: account.name || account.id,
          exchange: exchange,
          error: error.message,
        });
      }
    }

    // Calculate statistics
    const successResults = results.filter((r) => !r.error && r.balance);
    const errorResults = results.filter((r) => r.error);
    const assignedSymbolsResults = successResults.filter(
      (r) => r.action === "assigned_symbols"
    );
    const setInactiveResults = successResults.filter(
      (r) => r.action === "set_inactive"
    );
    const updateErrorResults = successResults.filter((r) => r.updateError);

    console.log(
      `[CRON] Summary: Processed ${results.length}, Success: ${successResults.length}, Errors: ${errorResults.length}, Assigned: ${assignedSymbolsResults.length}, Inactive: ${setInactiveResults.length}`
    );

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      totalAccounts: emptyAccounts.length,
      successCount: successResults.length,
      errorCount: errorResults.length,
      assignedSymbolsCount: assignedSymbolsResults.length,
      setInactiveCount: setInactiveResults.length,
      updateErrorCount: updateErrorResults.length,
      equityThreshold: EQUITY_THRESHOLD,
      defaultTradingSymbols: DEFAULT_TRADING_SYMBOLS,
      results: results,
    });
  } catch (error: any) {
    console.error("[CRON] Fatal error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
