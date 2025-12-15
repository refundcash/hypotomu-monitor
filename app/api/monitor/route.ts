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
  getGridLevelsBothSides,
  setMarketPrice,
  getRedisClient,
  getLatestPositions,
} from "@/lib/redis";

interface Account {
  id: string;
  name: string;
  api_key?: string;
  api_secret?: string;
  api_passphrase?: string;
  exchange?: string;
  status: string;
}

// Removed - we no longer fetch positions or orders from exchange directly
// These are now retrieved from Redis (updated by backend-cron every 2 minutes)

/**
 * Convert symbol between exchange formats
 * AsterDex format: BTCUSDT (no hyphens)
 * OKX format: BTC-USDT-SWAP (with hyphens and SWAP suffix)
 */
function convertSymbolFormat(symbol: string, targetExchange: "okx" | "asterdex"): string {
  if (targetExchange === "okx") {
    // Convert from AsterDex format (BTCUSDT) to OKX format (BTC-USDT-SWAP)
    if (!symbol.includes("-") && symbol.endsWith("USDT")) {
      const baseAsset = symbol.replace("USDT", "");
      return `${baseAsset}-USDT-SWAP`;
    }
    // Already in OKX format
    return symbol;
  } else {
    // Convert from OKX format (BTC-USDT-SWAP) to AsterDex format (BTCUSDT)
    if (symbol.includes("-") && symbol.endsWith("-SWAP")) {
      const baseAsset = symbol.replace("-USDT-SWAP", "");
      return `${baseAsset}USDT`;
    }
    // Already in AsterDex format
    return symbol;
  }
}

async function getTickerPrice(okx: OKXClient, symbol: string) {
  try {
    const response = await okx.getTicker(symbol);
    console.log(`[OKX] Ticker response for ${symbol}:`, JSON.stringify(response));

    if (response.code === "0" && response.data.length > 0) {
      const ticker = response.data[0];
      const bid = parseFloat(ticker.bidPx);
      const ask = parseFloat(ticker.askPx);
      const last = parseFloat(ticker.last);
      const midPrice = (bid + ask) / 2;

      console.log(`[OKX] Calculated mid price for ${symbol}: ${midPrice} (bid: ${bid}, ask: ${ask}, last: ${last})`);

      // Store the mid price in Redis for OKX (matching ai-trading format)
      try {
        // Store with full price data structure
        const priceData = {
          price: midPrice,
          bid,
          ask,
          last,
          timestamp: Date.now(),
          exchange: "okx",
        };

        const client = getRedisClient();
        const key = `hypotomuai:okx:price:${symbol}`;
        await client.setex(key, 60, JSON.stringify(priceData));

        console.log(`[OKX] Successfully stored price in Redis: ${key} = ${midPrice}`);
      } catch (redisError) {
        console.error(`[OKX] Error storing price in Redis for ${symbol}:`, redisError);
      }

      return midPrice;
    }

    console.log(`[OKX] No ticker data found for ${symbol}`);
    return null;
  } catch (error) {
    console.error(`[OKX] Error getting ticker for ${symbol}:`, error);
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
  account: Account,
  publishedSymbols: Set<string>
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

    // Get all symbols to check (positions + published symbols)
    const symbolsToCheck = new Set<string>([
      ...Array.from(positionsBySymbol.keys()),
      ...publishedSymbols,
    ]);

    // If no symbols to check, return empty result
    if (symbolsToCheck.size === 0) {
      return [];
    }

    // Create a card for each symbol - process all symbols in parallel
    const symbolPromises = Array.from(symbolsToCheck).map(async (symbol) => {
      const symbolPositions = positionsBySymbol.get(symbol) || [];
      try {
        // Fetch all data for this symbol in parallel
        const [
          tickerResponse,
          exchangeInfo,
          { buy: buyGridLevels, sell: sellGridLevels },
        ] = await Promise.all([
          asterdex.getTicker(symbol),
          asterdex.getExchangeInfo(symbol),
          getGridLevelsBothSides(account.id, symbol, "asterdex"),
        ]);

        const currentPrice = tickerResponse?.lastPrice
          ? Number(tickerResponse.lastPrice)
          : tickerResponse?.bidPrice && tickerResponse?.askPrice
          ? (Number(tickerResponse.bidPrice) +
              Number(tickerResponse.askPrice)) /
            2
          : null;

        console.log(
          `[AsterDex] Calculated current price for ${symbol}: ${currentPrice}`
        );

        // Store the mid price in Redis for AsterDex
        if (currentPrice !== null) {
          try {
            await setMarketPrice("asterdex", symbol, currentPrice);
            console.log(
              `[AsterDex] Successfully stored price in Redis: hypotomuai:asterdex:price:${symbol} = ${currentPrice}`
            );
          } catch (redisError) {
            console.error(
              `[AsterDex] Error storing price in Redis for ${symbol}:`,
              redisError
            );
          }
        }

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

        // Skip if no positions AND no grid levels
        if (
          symbolPositions.length === 0 &&
          buyOrders.length === 0 &&
          sellOrders.length === 0
        ) {
          return null;
        }

        return {
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
        };
      } catch (symbolError: any) {
        console.error(`Error processing symbol ${symbol}:`, symbolError);
        // Return null for failed symbols
        return null;
      }
    });

    // Wait for all symbols to be processed in parallel
    const symbolResults = await Promise.all(symbolPromises);

    // Filter out null results and return
    return symbolResults.filter((result) => result !== null);
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

interface TradingSymbol {
  id: string;
  name: string;
  status: string;
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Fetch published trading symbols to filter accounts
    const tradingSymbols = await fetchItems<TradingSymbol[]>(
      "trading_symbols",
      {
        filter: { status: { _eq: "published" } },
        limit: -1,
        fields: ["name"],
      }
    );

    const publishedSymbols = new Set(tradingSymbols.map((s) => s.name));

    const accounts = await fetchItems<Account[]>("trading_accounts", {
      filter: {
        status: { _eq: "active" },
      },
      limit: -1,
      fields: ["*"],
    });

    // Process all accounts in parallel for much better performance
    const accountPromises = accounts.map(async (account) => {
      try {
        const exchange = account.exchange || "okx";
        const apiKey = account.api_key || process.env.OKX_API_KEY;
        const apiSecret = account.api_secret || process.env.OKX_API_SECRET;
        const passphrase = account.api_passphrase || process.env.OKX_PASSPHRASE;

        // Handle different exchanges
        if (exchange === "asterdex") {
          if (!apiKey || !apiSecret) {
            return [
              {
                accountId: account.id,
                accountName: account.name || account.id,
                symbol: "N/A",
                exchange: "asterdex",
                error: "Missing API credentials (API Key and Secret required)",
              },
            ];
          }

          const asterdex = new AsterdexClient(apiKey, apiSecret, true);
          const accountData = await processAsterdexAccount(
            asterdex,
            account,
            publishedSymbols
          );
          return accountData;
        } else {
          // Default to OKX
          if (!apiKey || !apiSecret || !passphrase) {
            return [
              {
                accountId: account.id,
                accountName: account.name || account.id,
                symbol: "N/A",
                exchange: "okx",
                error: "Missing API credentials",
              },
            ];
          }

          const okx = new OKXClient(apiKey, apiSecret, passphrase);

          // Get positions from Redis (updated by backend-cron every 2 minutes)
          const positionsSnapshot = await getLatestPositions(account.id);
          const positions = positionsSnapshot?.data?.positions || [];

          console.log(`[OKX] Retrieved ${positions.length} positions from Redis for account ${account.id}`);

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

          // Group positions by symbol (convert OKX format to AsterDex format for consistency)
          const positionsBySymbol = new Map<string, any[]>();
          for (const pos of positions) {
            const okxSymbol = pos.instId; // e.g., "ETH-USDT-SWAP"
            if (!okxSymbol) continue;

            // Convert OKX symbol to AsterDex format for grouping (ETH-USDT-SWAP -> ETHUSDT)
            const normalizedSymbol = convertSymbolFormat(okxSymbol, "asterdex");
            console.log(`[OKX] Position symbol normalization: ${okxSymbol} -> ${normalizedSymbol}`);

            if (!positionsBySymbol.has(normalizedSymbol)) {
              positionsBySymbol.set(normalizedSymbol, []);
            }
            positionsBySymbol.get(normalizedSymbol)!.push(pos);
          }

          console.log(`[OKX] Grouped positions by symbols:`, Array.from(positionsBySymbol.keys()));

          // Get all symbols to check (positions + published symbols)
          const symbolsToCheck = new Set<string>([
            ...Array.from(positionsBySymbol.keys()),
            ...publishedSymbols,
          ]);

          // If no symbols to check, return empty array
          if (symbolsToCheck.size === 0) {
            return [];
          }

          // Create a card for each symbol
          const symbolResults = [];
          for (const symbol of symbolsToCheck) {
            const symbolPositions = positionsBySymbol.get(symbol) || [];
            try {
              // Convert symbol to OKX format if needed (ETHUSDT -> ETH-USDT-SWAP)
              const okxSymbol = convertSymbolFormat(symbol, "okx");
              console.log(`[OKX] Symbol conversion: ${symbol} -> ${okxSymbol}`);

              const currentPrice = await getTickerPrice(okx, okxSymbol);
              const instrumentInfo = await getInstrumentInfo(okx, okxSymbol);
              const ctVal = instrumentInfo?.ctVal || 1;

              // Get grid levels from Redis for this symbol (both sides in parallel)
              const { buy: buyGridLevels, sell: sellGridLevels } =
                await getGridLevelsBothSides(account.id, symbol, "okx");

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

              // Skip if no positions AND no grid levels
              if (
                symbolPositions.length === 0 &&
                buyOrders.length === 0 &&
                sellOrders.length === 0
              ) {
                continue;
              }

              console.log(
                `[OKX] Adding symbol result for ${symbol}: currentPrice=${currentPrice}`
              );

              symbolResults.push({
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

          return symbolResults;
        }
      } catch (error: any) {
        return [
          {
            accountId: account.id,
            accountName: account.name || account.id,
            symbol: "ERROR",
            error: error.message,
          },
        ];
      }
    });

    // Wait for all accounts to be processed in parallel
    const accountResults = await Promise.all(accountPromises);

    // Flatten the results (each account returns an array)
    const allData = accountResults.flat();

    // Filter to only include published symbols
    const filteredData = allData.filter(
      (account) =>
        account.symbol === "ERROR" ||
        account.symbol === "N/A" ||
        publishedSymbols.has(account.symbol)
    );

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      accounts: filteredData,
      publishedSymbols: Array.from(publishedSymbols),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
