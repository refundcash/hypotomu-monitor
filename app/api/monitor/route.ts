import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { fetchItems } from "@/lib/directus";
import { OKXClient } from "@/lib/okx";
import { AsterdexClient } from "@/lib/asterdex";
import {
  storeEquitySnapshot,
  getEquity24hAgo,
  getGridLevels,
} from "@/lib/redis";

interface Account {
  id: string;
  name: string;
  api_key?: string;
  api_secret?: string;
  passphrase?: string;
  exchange?: string;
  status: string;
}

async function getAllPositions(okx: OKXClient) {
  try {
    const response = await okx.getPositions("SWAP");
    if (response.code === "0" && response.data) {
      return response.data.filter((pos: any) => Math.abs(Number(pos.pos)) > 0);
    }
    return [];
  } catch (error) {
    console.error("Error getting positions:", error);
    return [];
  }
}

// Removed - we no longer fetch pending orders from exchange
// Grid levels are stored in Redis instead

async function getTickerPrice(okx: OKXClient, symbol: string) {
  try {
    const response = await okx.getTicker(symbol);
    if (response.code === "0" && response.data.length > 0) {
      const ticker = response.data[0];
      const bid = parseFloat(ticker.bidPx);
      const ask = parseFloat(ticker.askPx);
      return (bid + ask) / 2;
    }
    return null;
  } catch (error) {
    console.error("Error getting ticker:", error);
    return null;
  }
}

async function getInstrumentInfo(okx: OKXClient, symbol: string) {
  try {
    const response = await okx.getInstrumentInfo(symbol);
    if (response.code === "0" && response.data.length > 0) {
      const info = response.data[0];
      return {
        tickSz: parseFloat(info.tickSz),
        lotSz: parseFloat(info.lotSz),
        ctVal: parseFloat(info.ctVal),
      };
    }
    return null;
  } catch (error) {
    console.error("Error getting instrument info:", error);
    return null;
  }
}

async function getAccountBalance(okx: OKXClient) {
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
    console.error("Error getting balance:", error);
    return null;
  }
}

async function processAsterdexAccount(
  asterdex: AsterdexClient,
  account: Account
) {
  try {
    // Get account balance
    const balanceResponse = await asterdex.getAccountBalance();
    const balances = Array.isArray(balanceResponse)
      ? balanceResponse
      : balanceResponse?.data || [];
    const usdtBalance = balances.find(
      (b: any) => b.asset === "USDT" || b.a === "USDT"
    );

    // Get ALL positions (not filtered by symbol)
    const positionsResponse = await asterdex.getPositions();

    const positions = Array.isArray(positionsResponse)
      ? positionsResponse
      : positionsResponse?.data || [];
    const activePositions = positions.filter(
      (pos: any) => Math.abs(Number(pos.positionAmt || pos.pa || 0)) > 0
    );

    // Calculate balance info
    const totalEquity = Number(
      usdtBalance?.balance || usdtBalance?.wb || usdtBalance?.walletBalance || 0
    );
    const availableBalance = Number(
      usdtBalance?.availableBalance ||
        usdtBalance?.ab ||
        usdtBalance?.availBal ||
        0
    );
    const balanceInUse = totalEquity - availableBalance;

    // Calculate total unrealized PnL from positions
    const unrealizedPnL = activePositions.reduce((sum: number, pos: any) => {
      return (
        sum +
        Number(pos.unRealizedProfit || pos.unrealizedProfit || pos.upl || 0)
      );
    }, 0);

    // Get 24h equity comparison
    let equity24hAgo: number | null = null;
    let equity24hChange: number | null = null;
    let equity24hChangePercent: number | null = null;

    if (totalEquity > 0) {
      try {
        await storeEquitySnapshot(account.id, totalEquity);
        equity24hAgo = await getEquity24hAgo(account.id);

        if (equity24hAgo !== null) {
          equity24hChange = totalEquity - equity24hAgo;
          equity24hChangePercent = (equity24hChange / equity24hAgo) * 100;
        }
      } catch (error) {
        console.error("Redis error:", error);
      }
    }

    // Group positions by symbol
    const positionsBySymbol = new Map<string, any[]>();
    for (const pos of activePositions) {
      const symbol = pos.symbol || pos.s;
      if (!symbol) continue;

      if (!positionsBySymbol.has(symbol)) {
        positionsBySymbol.set(symbol, []);
      }
      positionsBySymbol.get(symbol)!.push(pos);
    }

    // If no positions, return empty result
    if (positionsBySymbol.size === 0) {
      return [];
    }

    // Create a card for each symbol
    const results = [];
    for (const [symbol, symbolPositions] of positionsBySymbol) {
      try {
        // Get ticker price for this symbol
        const tickerResponse = await asterdex.getTicker(symbol);
        const currentPrice = tickerResponse?.lastPrice
          ? Number(tickerResponse.lastPrice)
          : tickerResponse?.bidPrice && tickerResponse?.askPrice
          ? (Number(tickerResponse.bidPrice) +
              Number(tickerResponse.askPrice)) /
            2
          : null;

        // Get exchange info to get contract size/multiplier
        const exchangeInfo = await asterdex.getExchangeInfo(symbol);

        // Extract contract size from exchange info
        let contractSize = 1; // Default to 1 if not found
        if (exchangeInfo?.symbols && Array.isArray(exchangeInfo.symbols)) {
          const symbolInfo = exchangeInfo.symbols.find(
            (s: any) => s.symbol === symbol
          );
          if (symbolInfo) {
            contractSize = Number(symbolInfo.contractSize || 1);
          }
        }

        // Get grid levels from Redis for this symbol
        const buyGridLevels = await getGridLevels(account.id, symbol, "buy");
        const sellGridLevels = await getGridLevels(account.id, symbol, "sell");

        // Filter to only pending grid levels and convert to order format
        const buyOrders = buyGridLevels
          .filter((level) => level.status === "pending")
          .map((level, idx) => {
            const sizeContracts = (level as any).sizeContracts || 0;
            const sizeUSD = (level as any).sizeUSD || 0;
            const price = level.price || 0;
            return {
              price: price,
              size: sizeContracts,
              value: sizeUSD,
              orderId: `grid_buy_${idx}`,
              instId: symbol,
            };
          })
          .sort((a, b) => b.price - a.price); // Highest price first

        const sellOrders = sellGridLevels
          .filter((level) => level.status === "pending")
          .map((level, idx) => {
            const sizeContracts = (level as any).sizeContracts || 0;
            const sizeUSD = (level as any).sizeUSD || 0;
            const price = level.price || 0;
            return {
              price: price,
              size: sizeContracts,
              value: sizeUSD,
              orderId: `grid_sell_${idx}`,
              instId: symbol,
            };
          })
          .sort((a, b) => a.price - b.price); // Lowest price first

        results.push({
          accountId: account.id,
          accountName: account.name || account.id,
          symbol: symbol,
          exchange: "asterdex",
          currentPrice: currentPrice,
          balance: {
            equity: totalEquity,
            availableBalance: availableBalance,
            balanceInUse: balanceInUse,
            unrealizedPnL: unrealizedPnL,
            equity24hAgo: equity24hAgo,
            equity24hChange: equity24hChange,
            equity24hChangePercent: equity24hChangePercent,
          },
          positions: symbolPositions.map((pos: any) => {
            const posAmt = Number(pos.positionAmt || pos.pa || 0);
            return {
              side: posAmt > 0 ? "LONG" : "SHORT",
              contracts: Math.abs(posAmt),
              avgPrice: Number(pos.entryPrice || pos.ep || 0),
              unrealizedPnL: Number(
                pos.unRealizedProfit || pos.unrealizedProfit || pos.upl || 0
              ),
              unrealizedPnLRatio:
                Number(pos.unRealizedProfitRatio || pos.uplRatio || 0) * 100,
              leverage: Number(pos.leverage || pos.lever || 1),
              notionalUsd: Math.abs(
                Number(pos.notional || pos.notionalUsd || 0)
              ),
              instId: symbol,
            };
          }),
          buyOrders: buyOrders,
          sellOrders: sellOrders,
        });
      } catch (symbolError: any) {
        console.error(`Error processing symbol ${symbol}:`, symbolError);
        // Continue with other symbols
      }
    }

    return results;
  } catch (error: any) {
    console.error(
      `[Asterdex] Error processing account ${account.name}:`,
      error
    );
    console.error(`[Asterdex] Error details:`, {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status,
      statusText: error.response?.statusText,
    });

    return [
      {
        accountId: account.id,
        accountName: account.name || account.id,
        symbol: "ERROR",
        exchange: "asterdex",
        error:
          error.response?.data?.msg ||
          error.response?.data?.message ||
          error.message,
        errorCode: error.response?.status,
      },
    ];
  }
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const accounts = await fetchItems<Account[]>("trading_accounts", {
      filter: { status: { _eq: "active" } },
      limit: -1,
      fields: ["*"],
    });

    const data = [];

    for (const account of accounts) {
      try {
        const exchange = account.exchange || "okx";
        const apiKey = account.api_key || process.env.OKX_API_KEY;
        const apiSecret = account.api_secret || process.env.OKX_API_SECRET;
        const passphrase = account.passphrase || process.env.OKX_PASSPHRASE;

        // Handle different exchanges
        if (exchange === "asterdex") {
          if (!apiKey || !apiSecret) {
            data.push({
              accountId: account.id,
              accountName: account.name || account.id,
              symbol: "N/A",
              exchange: "asterdex",
              error: "Missing API credentials (API Key and Secret required)",
            });
            continue;
          }

          const asterdex = new AsterdexClient(apiKey, apiSecret, true);
          const accountData = await processAsterdexAccount(asterdex, account);
          // Flatten array results
          data.push(...accountData);
        } else {
          // Default to OKX
          if (!apiKey || !apiSecret || !passphrase) {
            data.push({
              accountId: account.id,
              accountName: account.name || account.id,
              symbol: "N/A",
              exchange: "okx",
              error: "Missing API credentials",
            });
            continue;
          }

          const okx = new OKXClient(apiKey, apiSecret, passphrase);

          // Get ALL positions
          const positions = await getAllPositions(okx);
          const balance = await getAccountBalance(okx);

          const balanceInUse = balance
            ? balance.totalEquity - balance.availableBalance
            : 0;

          // Get 24h equity comparison
          let equity24hAgo: number | null = null;
          let equity24hChange: number | null = null;
          let equity24hChangePercent: number | null = null;

          if (balance) {
            try {
              await storeEquitySnapshot(account.id, balance.totalEquity);
              equity24hAgo = await getEquity24hAgo(account.id);

              if (equity24hAgo !== null) {
                equity24hChange = balance.totalEquity - equity24hAgo;
                equity24hChangePercent = (equity24hChange / equity24hAgo) * 100;
              }
            } catch (error) {
              console.error("Redis error:", error);
            }
          }

          // Group positions by symbol
          const positionsBySymbol = new Map<string, any[]>();
          for (const pos of positions) {
            const symbol = pos.instId;
            if (!symbol) continue;

            if (!positionsBySymbol.has(symbol)) {
              positionsBySymbol.set(symbol, []);
            }
            positionsBySymbol.get(symbol)!.push(pos);
          }

          // If no positions, skip this account
          if (positionsBySymbol.size === 0) {
            continue;
          }

          // Create a card for each symbol
          for (const [symbol, symbolPositions] of positionsBySymbol) {
            try {
              const currentPrice = await getTickerPrice(okx, symbol);
              const instrumentInfo = await getInstrumentInfo(okx, symbol);
              const ctVal = instrumentInfo?.ctVal || 1;

              // Get grid levels from Redis for this symbol
              const buyGridLevels = await getGridLevels(
                account.id,
                symbol,
                "buy"
              );
              const sellGridLevels = await getGridLevels(
                account.id,
                symbol,
                "sell"
              );

              // Filter to only pending grid levels and convert to order format
              const buyOrders = buyGridLevels
                .filter((level) => level.status === "pending")
                .map((level, idx) => {
                  const sizeContracts = (level as any).sizeContracts || 0;
                  const sizeUSD = (level as any).sizeUSD || 0;
                  const price = level.price || 0;
                  return {
                    price: price,
                    size: sizeContracts,
                    value: sizeUSD,
                    orderId: `grid_buy_${idx}`,
                    instId: symbol,
                  };
                })
                .sort((a, b) => b.price - a.price);

              const sellOrders = sellGridLevels
                .filter((level) => level.status === "pending")
                .map((level, idx) => {
                  const sizeContracts = (level as any).sizeContracts || 0;
                  const sizeUSD = (level as any).sizeUSD || 0;
                  const price = level.price || 0;
                  return {
                    price: price,
                    size: sizeContracts,
                    value: sizeUSD,
                    orderId: `grid_sell_${idx}`,
                    instId: symbol,
                  };
                })
                .sort((a, b) => a.price - b.price);

              console.log(
                `[OKX] Final buy orders for ${symbol}:`,
                JSON.stringify(buyOrders)
              );
              console.log(
                `[OKX] Final sell orders for ${symbol}:`,
                JSON.stringify(sellOrders)
              );

              data.push({
                accountId: account.id,
                accountName: account.name || account.id,
                symbol: symbol,
                exchange: "okx",
                currentPrice: currentPrice,
                balance: balance
                  ? {
                      equity: balance.totalEquity,
                      availableBalance: balance.availableBalance,
                      balanceInUse: balanceInUse,
                      unrealizedPnL: balance.upl,
                      equity24hAgo: equity24hAgo,
                      equity24hChange: equity24hChange,
                      equity24hChangePercent: equity24hChangePercent,
                    }
                  : null,
                positions: symbolPositions.map((pos: any) => ({
                  side: Number(pos.pos) > 0 ? "LONG" : "SHORT",
                  contracts: Math.abs(Number(pos.pos)),
                  avgPrice: Number(pos.avgPx),
                  unrealizedPnL: Number(pos.upl),
                  unrealizedPnLRatio: Number(pos.uplRatio) * 100,
                  leverage: Number(pos.lever),
                  notionalUsd: Math.abs(Number(pos.notionalUsd)),
                  instId: pos.instId,
                })),
                buyOrders: buyOrders,
                sellOrders: sellOrders,
              });
            } catch (symbolError: any) {
              console.error(`Error processing symbol ${symbol}:`, symbolError);
              // Continue with other symbols
            }
          }
        }
      } catch (error: any) {
        data.push({
          accountId: account.id,
          accountName: account.name || account.id,
          symbol: "ERROR",
          error: error.message,
        });
      }
    }

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      accounts: data,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
