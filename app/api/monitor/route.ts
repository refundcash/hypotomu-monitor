import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { fetchItems } from "@/lib/directus";
import { OKXClient } from "@/lib/okx";
import { storeEquitySnapshot, getEquity24hAgo } from "@/lib/redis";

interface Account {
  id: string;
  name: string;
  symbol: string;
  api_key?: string;
  api_secret?: string;
  passphrase?: string;
  status: string;
}

async function getPositions(okx: OKXClient, symbol: string) {
  try {
    const response = await okx.getPositions("SWAP");
    if (response.code === "0" && response.data) {
      return response.data.filter(
        (pos: any) => pos.instId === symbol && Math.abs(Number(pos.pos)) > 0
      );
    }
    return [];
  } catch (error) {
    console.error("Error getting positions:", error);
    return [];
  }
}

async function getOrders(okx: OKXClient, symbol: string) {
  try {
    const response = await okx.getPendingOrders("SWAP", symbol);
    if (response.code === "0" && response.data) {
      return response.data;
    }
    return [];
  } catch (error) {
    console.error("Error getting orders:", error);
    return [];
  }
}

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

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const accounts = await fetchItems<Account[]>("mm_trading_accounts", {
      filter: { status: { _eq: "published" } },
      limit: -1,
      fields: ["*"],
    });

    const data = [];

    for (const account of accounts) {
      try {
        const apiKey = account.api_key || process.env.OKX_API_KEY;
        const apiSecret = account.api_secret || process.env.OKX_API_SECRET;
        const passphrase = account.passphrase || process.env.OKX_PASSPHRASE;

        if (!apiKey || !apiSecret || !passphrase) {
          data.push({
            accountId: account.id,
            accountName: account.name || account.id,
            symbol: account.symbol,
            error: "Missing API credentials",
          });
          continue;
        }

        const okx = new OKXClient(apiKey, apiSecret, passphrase);
        const currentPrice = await getTickerPrice(okx, account.symbol);
        const instrumentInfo = await getInstrumentInfo(okx, account.symbol);
        const ctVal = instrumentInfo?.ctVal || 1;
        const positions = await getPositions(okx, account.symbol);
        const orders = await getOrders(okx, account.symbol);
        const balance = await getAccountBalance(okx);

        const buyOrders = orders
          .filter((o: any) => o.side === "buy")
          .sort((a: any, b: any) => Number(b.px) - Number(a.px));
        const sellOrders = orders
          .filter((o: any) => o.side === "sell")
          .sort((a: any, b: any) => Number(a.px) - Number(b.px));

        const balanceInUse = balance
          ? balance.totalEquity - balance.availableBalance
          : 0;

        // Get 24h equity comparison
        let equity24hAgo: number | null = null;
        let equity24hChange: number | null = null;
        let equity24hChangePercent: number | null = null;

        if (balance) {
          try {
            // Store current equity snapshot
            await storeEquitySnapshot(account.id, balance.totalEquity);

            // Get equity from 24h ago
            equity24hAgo = await getEquity24hAgo(account.id);

            if (equity24hAgo !== null) {
              equity24hChange = balance.totalEquity - equity24hAgo;
              equity24hChangePercent = (equity24hChange / equity24hAgo) * 100;
            }
          } catch (error) {
            console.error("Redis error:", error);
            // Continue without 24h comparison if Redis fails
          }
        }

        data.push({
          accountId: account.id,
          accountName: account.name || account.id,
          symbol: account.symbol,
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
          positions: positions.map((pos: any) => ({
            side: Number(pos.pos) > 0 ? "LONG" : "SHORT",
            contracts: Math.abs(Number(pos.pos)),
            avgPrice: Number(pos.avgPx),
            unrealizedPnL: Number(pos.upl),
            unrealizedPnLRatio: Number(pos.uplRatio) * 100,
            leverage: Number(pos.lever),
            notionalUsd: Math.abs(Number(pos.notionalUsd)),
            instId: pos.instId,
          })),
          buyOrders: buyOrders.map((order: any) => ({
            price: Number(order.px),
            size: Number(order.sz),
            value: Number(order.px) * Number(order.sz) * ctVal,
            orderId: order.ordId,
            instId: order.instId,
          })),
          sellOrders: sellOrders.map((order: any) => ({
            price: Number(order.px),
            size: Number(order.sz),
            value: Number(order.px) * Number(order.sz) * ctVal,
            orderId: order.ordId,
            instId: order.instId,
          })),
        });
      } catch (error: any) {
        data.push({
          accountId: account.id,
          accountName: account.name || account.id,
          symbol: account.symbol,
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
