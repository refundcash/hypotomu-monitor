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
  trading_symbols?: Array<{
    trading_symbols_id: {
      id: string;
      name: string;
      status: string;
    };
  }>;
}

// Removed - we no longer fetch positions or orders from exchange directly
// These are now retrieved from Redis (updated by backend-cron every 2 minutes)

/**
 * Format price with appropriate decimal places
 * Returns number rounded to avoid floating point precision issues
 */
function formatPrice(price: number | null): number | null {
  if (price === null) return null;
  // Use 3 decimal places for crypto prices
  return Number(price.toFixed(3));
}

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

    if (response.code === "0" && response.data.length > 0) {
      const ticker = response.data[0];
      const bid = parseFloat(ticker.bidPx);
      const ask = parseFloat(ticker.askPx);
      const last = parseFloat(ticker.last);

      // Check for invalid prices
      if (isNaN(bid) || isNaN(ask) || bid <= 0 || ask <= 0) {
        console.error(`[OKX] Invalid ticker prices for ${symbol}: bid=${bid}, ask=${ask}`);
        return null;
      }

      const midPrice = (bid + ask) / 2;

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
      } catch (redisError) {
        console.error(`[OKX] Error storing price in Redis for ${symbol}:`, redisError);
      }

      return midPrice;
    }

    console.error(`[OKX] No ticker data found for ${symbol}, response:`, JSON.stringify(response));
    return null;
  } catch (error: any) {
    console.error(`[OKX] Error getting ticker for ${symbol}:`, error.message);
    console.error(`[OKX] Full error details:`, error);
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
  accountSymbols: Set<string>,
  priceMap: Map<string, number | null>
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

    // Get all symbols to check (positions + account symbols)
    const symbolsToCheck = new Set<string>([
      ...Array.from(positionsBySymbol.keys()),
      ...accountSymbols,
    ]);

    // If no symbols to check, return empty result
    if (symbolsToCheck.size === 0) {
      return [];
    }

    // Create a card for each symbol - process all symbols in parallel
    const symbolPromises = Array.from(symbolsToCheck).map(async (symbol) => {
      const symbolPositions = positionsBySymbol.get(symbol) || [];
      try {
        // Get pre-fetched price from the price map
        const currentPrice = priceMap.get(symbol) || null;

        // Fetch exchange info and grid levels in parallel
        const [
          exchangeInfo,
          { buy: buyGridLevels, sell: sellGridLevels },
        ] = await Promise.all([
          asterdex.getExchangeInfo(symbol),
          getGridLevelsBothSides(account.id, symbol, "asterdex"),
        ]);

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
              price: formatPrice(price),
              size: sizeContracts,
              value: sizeUSD,
              orderId: `grid_buy_${idx}`,
              instId: symbol,
            };
          })
          .sort((a, b) => (b.price || 0) - (a.price || 0)); // Highest price first

        const sellOrders = sellGridLevels
          .filter((level) => level.status === "pending")
          .map((level, idx) => {
            const sizeContracts = (level as any).sizeContracts || 0;
            const sizeUSD = (level as any).sizeUSD || 0;
            const price = level.price || 0;
            return {
              price: formatPrice(price),
              size: sizeContracts,
              value: sizeUSD,
              orderId: `grid_sell_${idx}`,
              instId: symbol,
            };
          })
          .sort((a, b) => (a.price || 0) - (b.price || 0)); // Lowest price first

        // Only skip if symbol has no positions, no grid levels, AND no current price
        // This ensures we still show mid price for published symbols even without positions
        if (
          symbolPositions.length === 0 &&
          buyOrders.length === 0 &&
          sellOrders.length === 0 &&
          currentPrice === null
        ) {
          return null;
        }

        const positions = symbolPositions.map((pos: any) => {
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
        });

        // Calculate total position value for sorting
        const totalPositionValue = positions.reduce(
          (sum, pos) => sum + pos.notionalUsd,
          0
        );

        return {
          accountId: account.id,
          accountName: account.name || account.id,
          symbol: symbol,
          exchange: "asterdex",
          currentPrice: formatPrice(currentPrice),
          balance: {
            equity: totalEquity,
            availableBalance: availableBalance,
            balanceInUse: balanceInUse,
            unrealizedPnL: unrealizedPnL,
            equity24hAgo: equity24hAgo,
            equity24hChange: equity24hChange,
            equity24hChangePercent: equity24hChangePercent,
          },
          positions: positions,
          buyOrders: buyOrders,
          sellOrders: sellOrders,
          totalPositionValue: totalPositionValue,
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

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Fetch trading accounts with their associated trading symbols (OKX only)
    const accounts = await fetchItems<Account[]>("trading_accounts", {
      filter: {
        status: { _eq: "active" },
        exchange: { _eq: "okx" },
      },
      limit: -1,
      fields: ["*", "trading_symbols.trading_symbols_id.*"],
    });

    // Collect all unique symbols across all accounts
    const allSymbols = new Set<string>();
    const accountSymbolsMap = new Map<string, Set<string>>();

    accounts.forEach((account) => {
      const accountSymbols = new Set<string>(
        account.trading_symbols
          ?.filter((ts) => ts.trading_symbols_id?.status === "published")
          .map((ts) => ts.trading_symbols_id.name) || []
      );
      accountSymbolsMap.set(account.id, accountSymbols);
      accountSymbols.forEach((symbol) => allSymbols.add(symbol));
    });

    // Fetch prices for all symbols once (in parallel) - this is much more efficient
    const priceMap = new Map<string, number | null>();

    // For now, we'll fetch from Redis (prices are updated by backend-cron)
    // We could also fetch from exchange APIs here, but Redis is faster and already updated
    const pricePromises = Array.from(allSymbols).map(async (symbol) => {
      try {
        const client = getRedisClient();
        // Try OKX format first
        const okxSymbol = convertSymbolFormat(symbol, "okx");
        let redisKey = `hypotomuai:okx:price:${okxSymbol}`;
        let cachedPrice = await client.get(redisKey);

        if (cachedPrice) {
          const priceData = JSON.parse(cachedPrice);
          priceMap.set(symbol, priceData.price || null);
          return;
        }

        // Try AsterDex format
        redisKey = `hypotomuai:asterdex:price:${symbol}`;
        cachedPrice = await client.get(redisKey);

        if (cachedPrice) {
          priceMap.set(symbol, Number(cachedPrice));
          return;
        }

        console.warn(`[Monitor] No price found in Redis for ${symbol}`);
        priceMap.set(symbol, null);
      } catch (error) {
        console.error(`[Monitor] Error fetching price for ${symbol}:`, error);
        priceMap.set(symbol, null);
      }
    });

    await Promise.all(pricePromises);

    // Process all accounts in parallel for much better performance
    const accountPromises = accounts.map(async (account) => {
      try {
        // Get pre-computed account symbols
        const accountSymbols = accountSymbolsMap.get(account.id) || new Set<string>();

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
            accountSymbols,
            priceMap
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

            if (!positionsBySymbol.has(normalizedSymbol)) {
              positionsBySymbol.set(normalizedSymbol, []);
            }
            positionsBySymbol.get(normalizedSymbol)!.push(pos);
          }

          // Get all symbols to check (positions + account-specific symbols)
          const symbolsToCheck = new Set<string>([
            ...Array.from(positionsBySymbol.keys()),
            ...accountSymbols,
          ]);

          // If no symbols to check, return empty array
          if (symbolsToCheck.size === 0) {
            return [];
          }

          // Fetch instrument info ONCE for the first symbol and reuse for all
          // (All USDT-SWAP contracts have same specifications)
          let sharedInstrumentInfo: any = null;
          if (symbolsToCheck.size > 0) {
            const firstSymbol = Array.from(symbolsToCheck)[0];
            const firstOkxSymbol = convertSymbolFormat(firstSymbol, "okx");
            try {
              sharedInstrumentInfo = await getInstrumentInfo(okx, firstOkxSymbol);
            } catch (error) {
              console.error(`[OKX] Error fetching instrument info for ${firstSymbol}:`, error);
            }
          }

          // Create a card for each symbol
          const symbolResults = [];
          for (const symbol of symbolsToCheck) {
            const symbolPositions = positionsBySymbol.get(symbol) || [];
            try {
              // Get pre-fetched price from the price map
              const currentPrice = priceMap.get(symbol) || null;

              // Use shared instrument info (fetched once for all symbols)
              const ctVal = sharedInstrumentInfo?.ctVal || 1;

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
                    price: formatPrice(price),
                    size: sizeContracts,
                    value: sizeUSD,
                    orderId: `grid_buy_${idx}`,
                    instId: symbol,
                  };
                })
                .sort((a, b) => (b.price || 0) - (a.price || 0));

              const sellOrders = sellGridLevels
                .filter((level) => level.status === "pending")
                .map((level, idx) => {
                  const sizeContracts = (level as any).sizeContracts || 0;
                  const sizeUSD = (level as any).sizeUSD || 0;
                  const price = level.price || 0;
                  return {
                    price: formatPrice(price),
                    size: sizeContracts,
                    value: sizeUSD,
                    orderId: `grid_sell_${idx}`,
                    instId: symbol,
                  };
                })
                .sort((a, b) => (a.price || 0) - (b.price || 0));

              // Only skip if symbol has no positions, no grid levels, AND no current price
              // This ensures we still show mid price for published symbols even without positions
              if (
                symbolPositions.length === 0 &&
                buyOrders.length === 0 &&
                sellOrders.length === 0 &&
                currentPrice === null
              ) {
                continue;
              }

              const positions = symbolPositions.map((pos: any) => ({
                side: Number(pos.pos) > 0 ? "LONG" : "SHORT",
                contracts: Math.abs(Number(pos.pos)),
                avgPrice: Number(pos.avgPx),
                unrealizedPnL: Number(pos.upl),
                unrealizedPnLRatio: Number(pos.uplRatio) * 100,
                leverage: Number(pos.lever),
                notionalUsd: Math.abs(Number(pos.notionalUsd)),
                instId: pos.instId,
              }));

              // Calculate total position value for sorting
              const totalPositionValue = positions.reduce(
                (sum, pos) => sum + pos.notionalUsd,
                0
              );

              symbolResults.push({
                accountId: account.id,
                accountName: account.name || account.id,
                symbol: symbol,
                exchange: "okx",
                currentPrice: formatPrice(currentPrice),
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
                positions: positions,
                buyOrders: buyOrders,
                sellOrders: sellOrders,
                totalPositionValue: totalPositionValue,
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

    // Sort by total position value (biggest first)
    const sortedData = allData.sort((a, b) => {
      const aValue = (a as any).totalPositionValue || 0;
      const bValue = (b as any).totalPositionValue || 0;
      return bValue - aValue; // Descending order
    });

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      accounts: sortedData,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
